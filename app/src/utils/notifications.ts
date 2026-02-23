import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Configure notification handler
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
  type: 'dm' | 'group';
  conversationId?: string;
  groupId?: string;
  senderPubkey: string;
  senderName?: string;
  messagePreview: string;
}

/**
 * Initialize the notifications system
 * Call this when the app starts
 */
export async function initializeNotifications(): Promise<boolean> {
  try {
    // Request permissions
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

    // Set up Android notification channel (required for Android)
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF6B6B',
        sound: 'default',
      });

      console.log('✅ Android notification channel created');
    }

    return true;
  } catch (error) {
    console.error('❌ Failed to initialize notifications:', error);
    return false;
  }
}

/**
 * Send a local notification for a new message
 */
export async function sendMessageNotification(
  senderPubkey: string,
  senderName: string | undefined,
  messagePreview: string,
  conversationId: string,
  type: 'dm' | 'group',
  groupId?: string
): Promise<void> {
  try {
    const title = type === 'dm'
      ? (senderName || `${senderPubkey.slice(0, 8)}...`)
      : (senderName ? `${senderName} in group` : `Group message`);

    // Truncate message preview if too long
    const truncatedPreview = messagePreview.length > 100
      ? messagePreview.slice(0, 97) + '...'
      : messagePreview;

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body: truncatedPreview,
        data: {
          type,
          conversationId,
          groupId,
          senderPubkey,
          senderName,
          messagePreview,
        } as NotificationData,
        sound: 'default',
      },
      trigger: null, // Send immediately
    });

    console.log(`✅ Notification sent for message from ${senderName || senderPubkey.slice(0, 8)}...`);
  } catch (error) {
    console.error('❌ Failed to send notification:', error);
  }
}

/**
 * Update the app badge count
 */
export async function setBadgeCount(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(count);
    console.log(`✅ Badge count set to ${count}`);
  } catch (error) {
    console.error('❌ Failed to set badge count:', error);
  }
}
