import * as Notifications from 'expo-notifications';
import { Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
} from '@notifee/react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface NotificationData {
  type: 'dm' | 'group' | 'call';
  conversationId?: string;
  groupId?: string;
  senderPubkey: string;
  senderName?: string;
  messagePreview: string;
}

export async function initializeNotifications(): Promise<boolean> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('❌ Notification permissions not granted');
      return false;
    }

    console.log('✅ Notification permissions granted');

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF6B6B',
        sound: 'default',
      });

      console.log('✅ Android notification channel created');

      // Android 14+ (API 34): USE_FULL_SCREEN_INTENT is not auto-granted.
      // Direct user to the specific settings page once so full-screen call popup works.
      if (Platform.Version >= 34) {
        const prompted = await AsyncStorage.getItem('@mukon_fsi_prompted');
        if (!prompted) {
          await AsyncStorage.setItem('@mukon_fsi_prompted', '1');
          console.log('⚠️ Android 14+ — opening full screen intent settings');
          await Linking.sendIntent(
            'android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENTS',
            [{ key: 'android.provider.extra.APP_PACKAGE', value: 'com.mukon.messenger' }]
          );
        }
      }
    }

    return true;
  } catch (error) {
    console.error('❌ Failed to initialize notifications:', error);
    return false;
  }
}

export async function sendMessageNotification(
  senderPubkey: string,
  senderName: string | undefined,
  messagePreview: string,
  conversationId: string,
  type: 'dm' | 'group',
  groupId?: string,
  groupName?: string
): Promise<void> {
  try {
    const displayName = senderName || `${senderPubkey.slice(0, 8)}...`;
    const body = type === 'dm'
      ? `${displayName}: ${messagePreview}`
      : `${displayName}${groupName ? ` in ${groupName}` : ''}: ${messagePreview}`;

    const truncatedBody = body.length > 100 ? body.slice(0, 97) + '...' : body;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Mukon Messenger',
        body: truncatedBody,
        data: {
          type,
          conversationId,
          groupId,
          senderPubkey,
          senderName,
          messagePreview,
        } as NotificationData,
        sound: 'default',
        ...(Platform.OS === 'android' && { android: { channelId: 'messages' } } as any),
      },
      trigger: null,
    });

    console.log(`✅ Notification sent for message from ${displayName}`);
  } catch (error) {
    console.error('❌ Failed to send notification:', error);
  }
}

// Full-screen incoming call notification via notifee.
// On a locked/off screen: wakes the device and shows full-screen overlay.
// When phone is in use: shows a large heads-up banner with Accept/Decline.
export async function sendCallNotification(
  callerName: string,
  callerPubkey: string
): Promise<void> {
  try {
    const displayName = callerName || `${callerPubkey.slice(0, 8)}...`;

    const channelId = await notifee.createChannel({
      id: 'calls',
      name: 'Incoming Calls',
      importance: AndroidImportance.HIGH,
      vibration: true,
      sound: 'default',
      bypassDnd: true,
    });

    await notifee.displayNotification({
      id: 'incoming-call',
      title: 'Incoming call',
      body: `${displayName} is calling...`,
      android: {
        channelId,
        category: AndroidCategory.CALL,
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        // Wakes screen and shows full-screen overlay on locked/off screen
        fullScreenAction: {
          id: 'default',
          launchActivity: 'default',
        },
        pressAction: { id: 'default', launchActivity: 'default' },
        actions: [
          {
            title: '📵 Decline',
            pressAction: { id: 'decline' },
          },
          {
            title: '📞 Accept',
            pressAction: { id: 'accept' },
          },
        ],
        sound: 'default',
        vibrationPattern: [0, 500, 250, 500, 250, 500],
        lights: ['#22c55e', 500, 500],
      },
    });

    console.log(`✅ Call notification sent for ${displayName}`);
  } catch (error) {
    console.error('❌ Failed to send call notification:', error);
  }
}

export async function setBadgeCount(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch (error) {
    console.error('❌ Failed to set badge count:', error);
  }
}

export async function setupFcm(socket: any): Promise<void> {
  try {
    const { getMessaging, getToken, setBackgroundMessageHandler } =
      require('@react-native-firebase/messaging');
    const messagingInstance = getMessaging();
    const token = await getToken(messagingInstance);
    socket.emit('register_fcm_token', { token });

    setBackgroundMessageHandler(messagingInstance, async (remoteMessage: any) => {
      if (remoteMessage.data?.type === 'incoming_call') {
        await sendCallNotification(
          remoteMessage.data.callerName || 'Unknown',
          remoteMessage.data.callerPubkey || ''
        );
      }
    });

    console.log('✅ FCM token registered');
  } catch (e: any) {
    console.warn('⚠️ FCM setup failed:', e?.message || e);
  }
}
