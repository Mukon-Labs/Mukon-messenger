import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

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

      await Notifications.setNotificationChannelAsync('calls', {
        name: 'Calls',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 250, 500],
        lightColor: '#22C55E',
        sound: 'default',
        bypassDnd: true,
      });

      console.log('✅ Android notification channel created');
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

export async function sendCallNotification(
  callerName: string,
  callerPubkey: string
): Promise<void> {
  try {
    const displayName = callerName || `${callerPubkey.slice(0, 8)}...`;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Incoming call',
        body: `${displayName} is calling...`,
        data: { type: 'call', senderPubkey: callerPubkey },
        sound: 'default',
        ...(Platform.OS === 'android' && { android: { channelId: 'calls' } } as any),
      },
      trigger: null,
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

// FCM setup — no-ops gracefully if @react-native-firebase/messaging is not installed
// or google-services.json is not present. Activated by dropping google-services.json
// and running npm run build:prebuild.
export async function setupFcm(socket: any): Promise<void> {
  try {
    // Dynamic require so the app doesn't crash when Firebase is not configured
    const messaging = require('@react-native-firebase/messaging').default;
    const token = await messaging().getToken();
    socket.emit('register_fcm_token', { token });

    // Handle FCM messages when app is closed or backgrounded
    messaging().setBackgroundMessageHandler(async (remoteMessage: any) => {
      if (remoteMessage.data?.type === 'incoming_call') {
        await sendCallNotification(
          remoteMessage.data.callerName || 'Unknown',
          remoteMessage.data.callerPubkey || ''
        );
      }
    });

    console.log('✅ FCM token registered');
  } catch (e) {
    console.log('⚠️ FCM not configured (expected until google-services.json is added)');
  }
}
