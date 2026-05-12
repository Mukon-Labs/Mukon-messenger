import 'react-native-gesture-handler';
import 'react-native-get-random-values';
import { Buffer } from 'buffer';
import 'text-encoding-polyfill';
import notifee, { EventType } from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerRootComponent } from 'expo';
import App from './App';

// Polyfills for Solana web3.js and Anchor (per Solana Mobile docs)
global.Buffer = Buffer;

// CRITICAL: Buffer.prototype.subarray fix for Anchor in React Native
// From: https://docs.solanamobile.com/react-native/polyfill-guides/anchor
Buffer.prototype.subarray = function subarray(begin, end) {
  const result = Uint8Array.prototype.subarray.apply(this, [begin, end]);
  Object.setPrototypeOf(result, Buffer.prototype); // Adds readUIntLE!
  return result;
};

// Polyfill for structuredClone (not available in React Native)
if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = (obj) => JSON.parse(JSON.stringify(obj));
}

// Notifee background event handler — registered before React tree mounts.
// Handles Accept/Decline action button presses when app is backgrounded.
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (detail.notification?.id !== 'incoming-call') return;
  if (type === EventType.ACTION_PRESS) {
    if (detail.pressAction?.id === 'decline') {
      // Store flag so CallContext emits decline via socket when app foregrounds
      await AsyncStorage.setItem('@mukon_pending_decline', detail.notification.id);
    }
    await notifee.cancelNotification('incoming-call');
  }
});

registerRootComponent(App);
