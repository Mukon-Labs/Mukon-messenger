import React, { useEffect } from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { Provider as PaperProvider } from 'react-native-paper';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from './src/theme';
import { WalletProvider, useWallet } from './src/contexts/WalletContext';
import { MessengerProvider } from './src/contexts/MessengerContext';
import { CallProvider } from './src/contexts/CallContext';
import { AlertProvider } from './src/contexts/AlertContext';
import WalletConnectScreen from './src/screens/WalletConnectScreen';
import ContactsScreen from './src/screens/ContactsScreen';
import ContactsListScreen from './src/screens/ContactsListScreen';
import ChatScreen from './src/screens/ChatScreen';
import AddContactScreen from './src/screens/AddContactScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import CreateGroupScreen from './src/screens/CreateGroupScreen';
import GroupChatScreen from './src/screens/GroupChatScreen';
import GroupInfoScreen from './src/screens/GroupInfoScreen';
import InviteMemberScreen from './src/screens/InviteMemberScreen';
import CustomDrawer from './src/components/CustomDrawer';
import CallUIOverlay from './src/components/CallUIOverlay';
import QRCodeDisplayScreen from './src/screens/QRCodeDisplayScreen';
import QRScannerScreen from './src/screens/QRScannerScreen';

const Stack = createStackNavigator();
const Drawer = createDrawerNavigator();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: theme.colors.primary,
    background: theme.colors.background,
    card: theme.colors.surface,
    text: theme.colors.textPrimary,
    border: theme.colors.surface,
  },
};

function DrawerNavigatorScreens() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawer {...props} />}
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.colors.surface,
        },
        headerTintColor: theme.colors.textPrimary,
        headerTitleStyle: {
          fontWeight: 'bold',
        },
        drawerStyle: {
          backgroundColor: theme.colors.background,
          width: 280,
        },
      }}
    >
      <Drawer.Screen
        name="Contacts"
        component={ContactsScreen}
        options={{ title: 'Mukon Messenger' }}
      />
    </Drawer.Navigator>
  );
}

function AppNavigator() {
  const wallet = useWallet();

  // Show nothing while restoring session (prevents flash of connect screen)
  if (wallet.isRestoring) {
    return null;
  }

  if (!wallet.connected) {
    return <WalletConnectScreen />;
  }

  return (
    <MessengerProvider wallet={wallet} cluster="devnet">
      <CallProvider>
        <CallUIOverlay />
        <NavigationContainer theme={navTheme}>
          <StatusBar style="light" />
          <Stack.Navigator
            screenOptions={{
              headerStyle: {
                backgroundColor: theme.colors.surface,
              },
              headerTintColor: theme.colors.textPrimary,
              headerTitleStyle: {
                fontWeight: 'bold',
              },
            }}
          >
            <Stack.Screen
              name="Main"
              component={DrawerNavigatorScreens}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Chat"
              component={ChatScreen}
              options={{ headerBackTitleVisible: false }}
            />
            <Stack.Screen
              name="AddContact"
              component={AddContactScreen}
              options={{ title: 'Add Contact' }}
            />
            <Stack.Screen
              name="ContactsList"
              component={ContactsListScreen}
              options={{ title: 'Contacts' }}
            />
            <Stack.Screen
              name="Profile"
              component={ProfileScreen}
              options={{ title: 'Profile' }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ title: 'Settings' }}
            />
            <Stack.Screen
              name="CreateGroup"
              component={CreateGroupScreen}
              options={{ title: 'Create Group' }}
            />
            <Stack.Screen
              name="GroupChat"
              component={GroupChatScreen}
              options={{ headerBackTitleVisible: false }}
            />
            <Stack.Screen
              name="GroupInfo"
              component={GroupInfoScreen}
              options={{ title: 'Group Info' }}
            />
            <Stack.Screen
              name="InviteMember"
              component={InviteMemberScreen}
              options={{ title: 'Invite Members' }}
            />
            <Stack.Screen
              name="QRCodeDisplay"
              component={QRCodeDisplayScreen}
              options={{ title: 'My QR Code' }}
            />
            <Stack.Screen
              name="QRScanner"
              component={QRScannerScreen}
              options={{ title: 'Scan QR Code' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </CallProvider>
    </MessengerProvider>
  );
}

export default function App() {
  // Set up notification handling
  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    // Listen for notification responses (when user taps a notification)
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      console.log('📬 Notification tapped:', data);
      if (data) {
        AsyncStorage.setItem('pendingNotification', JSON.stringify(data)).catch(console.error);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <WalletProvider>
        <PaperProvider theme={theme}>
          <AlertProvider>
            <AppNavigator />
          </AlertProvider>
        </PaperProvider>
      </WalletProvider>
    </GestureHandlerRootView>
  );
}
