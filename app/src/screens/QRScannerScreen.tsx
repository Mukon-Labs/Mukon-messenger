import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, Alert, Platform, PermissionsAndroid } from 'react-native';
import { Button, TextInput, ActivityIndicator } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { theme } from '../theme';
import { useDarkAlert } from '../components/DarkAlert';
import { useNavigation } from '@react-navigation/native';

interface ScannedAddress {
  data: string;
}

export default function QRScannerScreen() {
  const navigation = useNavigation();
  const { showAlert, DarkAlertComponent } = useDarkAlert();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [manualAddress, setManualAddress] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  const handleBarCodeScanned = ({ data }: ScannedAddress) => {
    if (scanned) return;
    setScanned(true);
    
    // Validate if it looks like a Solana address (base58, 32-44 chars)
    const isValidSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(data);
    const isValidDomain = data.endsWith('.sol') || data.endsWith('.skr');
    
    if (isValidSolanaAddress || isValidDomain) {
      // Navigate back to AddContact with the scanned address
      navigation.navigate('AddContact' as never, { scannedAddress: data } as never);
    } else {
      showAlert(
        'Invalid QR Code',
        'This QR code does not contain a valid Solana wallet address or domain.\n\nPlease scan a QR code containing a wallet address or .sol/.skr domain.'
      );
      setScanned(false);
    }
  };

  const handleManualSubmit = () => {
    const address = manualAddress.trim();
    if (!address) {
      showAlert('Error', 'Please enter a wallet address or domain');
      return;
    }

    const isValidSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    const isValidDomain = address.endsWith('.sol') || address.endsWith('.skr');

    if (isValidSolanaAddress || isValidDomain) {
      navigation.navigate('AddContact' as never, { scannedAddress: address } as never);
    } else {
      showAlert(
        'Invalid Address',
        'Please enter a valid Solana wallet address (32-44 characters) or a .sol/.skr domain.'
      );
    }
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Camera Permission Required</Text>
        <Text style={styles.subtitle}>
          We need camera access to scan QR codes
        </Text>
        <Button
          mode="contained"
          onPress={requestPermission}
          style={styles.button}
          buttonColor={theme.colors.primary}
        >
          Grant Permission
        </Button>
        
        <View style={styles.divider}>
          <Text style={styles.dividerText}>Or enter address manually</Text>
        </View>
        
        <Button
          mode="outlined"
          onPress={() => setShowManualInput(true)}
          style={styles.button}
        >
          Enter Address Manually
        </Button>

        {showManualInput && (
          <View style={styles.manualInput}>
            <TextInput
              value={manualAddress}
              onChangeText={setManualAddress}
              placeholder="Wallet address or domain"
              mode="outlined"
              style={styles.input}
              outlineColor={theme.colors.surface}
              activeOutlineColor={theme.colors.primary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Button
              mode="contained"
              onPress={handleManualSubmit}
              style={styles.button}
              buttonColor={theme.colors.primary}
            >
              Continue
            </Button>
          </View>
        )}

        {DarkAlertComponent}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{
            barcodeTypes: ['qr'],
          }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        >
          <View style={styles.overlay}>
            <View style={styles.scanArea}>
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
            </View>
          </View>
        </CameraView>
      </View>

      <View style={styles.info}>
        <Text style={styles.title}>Scan QR Code</Text>
        <Text style={styles.subtitle}>
          Position the QR code within the frame to scan
        </Text>

        {scanned && (
          <Button
            mode="contained"
            onPress={() => setScanned(false)}
            style={styles.button}
            buttonColor={theme.colors.primary}
          >
            Scan Again
          </Button>
        )}
      </View>

      <View style={styles.divider}>
        <Text style={styles.dividerText}>Or</Text>
      </View>

      <Button
        mode="outlined"
        onPress={() => navigation.goBack()}
        style={styles.button}
      >
        Cancel
      </Button>

      {DarkAlertComponent}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: 16,
  },
  cameraContainer: {
    height: 300,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  scanArea: {
    width: 200,
    height: 200,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: theme.colors.primary,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  info: {
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  button: {
    marginTop: 8,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.surface,
  },
  dividerText: {
    marginHorizontal: 16,
    color: theme.colors.textSecondary,
  },
  manualInput: {
    marginTop: 16,
  },
  input: {
    backgroundColor: theme.colors.surface,
    marginBottom: 16,
  },
});
