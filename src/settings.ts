import { SettingsBuilder } from '@dotmatrixlabs/dotx-plugin-sdk';
import { MQTTSettings, ConnectionState } from './types';

/**
 * Build the settings UI for the MQTT plugin
 */
export function buildSettingsUI(
  settings: SettingsBuilder,
  currentSettings: MQTTSettings,
  getConnectionState: () => ConnectionState,
  onSave: (settings: MQTTSettings) => void,
  onConnect: () => void,
  onDisconnect: () => void,
  channelButton: { getSelectedMap(): Record<string, boolean> }
) {
  const connectionState = getConnectionState();
  // Track settings changes locally and autosave
  const localSettings: Partial<MQTTSettings> = { ...currentSettings };

  // Helper to autosave settings
  const autosave = () => {
    const finalSettings: MQTTSettings = {
      ...currentSettings,
      ...localSettings
    };
    onSave(finalSettings);
  };

  // ===== CONNECTION SECTION =====
  const connectionSection = settings.addSection('connection')
    .setName('Connection Settings');

  // Status badge
  const statusBadge = settings.addBadge('connectionStatus')
    .setLabel('Connection Status')
    .setText(getStatusText(connectionState))
    .setStyle(getStatusStyle(connectionState))
    .setDesc('Current MQTT broker connection state');

  // Connect/Disconnect Button
  const connectionButton = settings.addButton('connectionButton')
    .setTitle(getButtonTitle(connectionState))
    .setStyle(getButtonStyle(connectionState))
    .onClick(() => {
      // Read the live state: the builder runs once, so a captured value goes stale.
      const state = getConnectionState();
      if (state === 'connected' || state === 'connecting') {
        onDisconnect();
      } else {
        onConnect();
      }
    });

  // Broker IP
  settings.addInput('brokerIP')
    .setType('text')
    .setLabel('Broker IP Address')
    .setPlaceholder('192.168.1.100')
    .setValue(currentSettings.brokerIP)
    .setRequired(true)
    .setDesc('IP address or hostname of the MQTT broker. Connection changes apply on the next Connect.')
    .onChange((data) => {
      localSettings.brokerIP = data.value;
      autosave();
    });

  // Broker Port
  settings.addInput('brokerPort')
    .setType('number')
    .setLabel('Broker Port')
    .setPlaceholder('1883')
    .setValue(currentSettings.brokerPort)
    .setRequired(true)
    .setDesc('Port number (default: 1883, SSL: 8883)')
    .onChange((data) => {
      localSettings.brokerPort = parseInt(data.value) || 1883;
      autosave();
    });

  // Topic Prefix
  settings.addInput('topicPrefix')
    .setType('text')
    .setLabel('Topic Prefix')
    .setPlaceholder('dotx')
    .setValue(currentSettings.topicPrefix)
    .setRequired(true)
    .setDesc('Base topic prefix for all messages')
    .onChange((data) => {
      localSettings.topicPrefix = data.value;
      autosave();
    });

  // ===== AUTHENTICATION SECTION =====
  const authSection = settings.addSection('authentication')
    .setExpandable(true)
    .setExpanded(false)
    .setName('Authentication');

  settings.addInfo('authInfo')
    .setText('Optional username and password for broker authentication')
    .setStyle('info');

  // Username
  settings.addInput('username')
    .setType('text')
    .setLabel('Username')
    .setPlaceholder('Leave empty if not required')
    .setValue(currentSettings.username)
    .setDesc('MQTT broker username (optional)')
    .onChange((data) => {
      localSettings.username = data.value;
      autosave();
    });

  // Password
  settings.addInput('password')
    .setType('text')
    .setLabel('Password')
    .setPlaceholder('Leave empty if not required')
    .setValue(currentSettings.password)
    .setDesc('MQTT broker password (optional)')
    .onChange((data) => {
      localSettings.password = data.value;
      autosave();
    });

  // Client ID
  settings.addInput('clientId')
    .setType('text')
    .setLabel('Client ID')
    .setPlaceholder('dotx-mqtt-plugin')
    .setValue(currentSettings.clientId)
    .setDesc('Unique identifier for this MQTT client')
    .onChange((data) => {
      localSettings.clientId = data.value;
      autosave();
    });

  // ===== ADVANCED SECTION =====
  const advancedSection = settings.addSection('advanced')
    .setExpandable(true)
    .setExpanded(false)
    .setName('Advanced Settings');

  // SSL/TLS
  settings.addSwitch('useSsl')
    .setLabel('Enable SSL/TLS')
    .setValue(currentSettings.useSsl)
    .setDesc('Use encrypted connection (change port to 8883)')
    .onChange((data) => {
      localSettings.useSsl = data.value;
      autosave();
    });

  // Keepalive
  settings.addInput('keepalive')
    .setType('number')
    .setLabel('Keepalive Interval')
    .setPlaceholder('60')
    .setValue(currentSettings.keepalive)
    .setDesc('Keepalive interval in seconds (default: 60)')
    .onChange((data) => {
      localSettings.keepalive = parseInt(data.value) || 60;
      autosave();
    });

  // QoS
  settings.addSelect('qos')
    .setLabel('Quality of Service (QoS)')
    .setOptions([
      { value: '0', label: 'QoS 0 - At most once' },
      { value: '1', label: 'QoS 1 - At least once' },
      { value: '2', label: 'QoS 2 - Exactly once' }
    ])
    .setValue(currentSettings.qos.toString())
    .setDesc('MQTT message delivery guarantee level')
    .onChange((data) => {
      localSettings.qos = parseInt(data.value) as 0 | 1 | 2;
      autosave();
    });

  // Clean Session
  settings.addSwitch('cleanSession')
    .setLabel('Clean Session')
    .setValue(currentSettings.cleanSession)
    .setDesc('Start with a clean session (no stored subscriptions)')
    .onChange((data) => {
      localSettings.cleanSession = data.value;
      autosave();
    });

  // Auto Reconnect
  settings.addSwitch('autoReconnect')
    .setLabel('Auto Reconnect')
    .setValue(currentSettings.autoReconnect)
    .setDesc('Automatically reconnect on connection loss')
    .onChange((data) => {
      localSettings.autoReconnect = data.value;
      autosave();
    });

  // Reconnect Interval
  settings.addInput('reconnectInterval')
    .setType('number')
    .setLabel('Reconnect Interval')
    .setPlaceholder('5')
    .setValue(currentSettings.reconnectInterval)
    .setDesc('Seconds between reconnection attempts (default: 5)')
    .onChange((data) => {
      localSettings.reconnectInterval = parseInt(data.value) || 5;
      autosave();
    });

  // Publish Rate Limit
  settings.addInput('publishRateLimit')
    .setType('number')
    .setLabel('Publish Rate Limit')
    .setPlaceholder('100')
    .setValue(currentSettings.publishRateLimit)
    .setDesc('Minimum milliseconds between publishes (default: 100)')
    .onChange((data) => {
      localSettings.publishRateLimit = parseInt(data.value) || 100;
      autosave();
    });

  // ===== CHANNEL SELECTION SECTION =====
  const channelSection = settings.addSection('channels')
    .setName('Channel Selection');

  // Channel Selection Mode
  settings.addSelect('channelSelectionMode')
    .setLabel('Channel Publishing Mode')
    .setOptions([
      { value: 'all', label: 'Send All Channels' },
      { value: 'button', label: 'Use System Util Button to Select Channels' }
    ])
    .setValue(currentSettings.channelSelectionMode)
    .setDesc('Choose how to select which channels to publish')
    .onChange((data) => {
      localSettings.channelSelectionMode = data.value as 'all' | 'button';
      if (data.value === 'all') {
        channelModeInfo.setText('All device slider changes will be published to MQTT automatically.');
        channelModeInfo.setStyle('info');
        updateChannelsSelectedList('all');
      } else {
        channelModeInfo.setText('Use the "MQTT Channels" button in the action mapper to select which channels to publish. Click on individual channels to toggle them.');
        channelModeInfo.setStyle('warning');
        updateChannelsSelectedList('button');
      }
      autosave();
    });

  // Channel mode info text
  const channelModeInfo = settings.addInfo('channelModeInfo')
    .setText(currentSettings.channelSelectionMode === 'all'
      ? 'All device slider changes will be published to MQTT automatically.'
      : 'Use the "MQTT Channels" button in the action mapper to select which channels to publish. Click on individual channels to toggle them.')
    .setStyle(currentSettings.channelSelectionMode === 'all' ? 'info' : 'warning');


  const channelsSelectedList = settings.addText('channelsSelectedList')
    .setLabel('Channels Selected')
    .setText('No channels selected')
    .setDesc('List of channels that are currently selected');


  // Function to get a string list of selected channels
  function updateChannelsSelectedList(channelSelectionMode: 'all' | 'button') {
    if (channelSelectionMode === 'all') {
      channelsSelectedList.setText('All channels');
    } else {
      // Get selected channels from button
      const selectedMap = channelButton.getSelectedMap();
      let selectedList = Object.keys(selectedMap)
        .filter(k => selectedMap[k])
        .map(k => parseInt(k));
      // Add 1 to each value (convert from 0-indexed to 1-indexed)
      selectedList = selectedList.map(k => k + 1);
      channelsSelectedList.setText(selectedList.length > 0 ? selectedList.join(', ') : 'None');
    }
  }

  updateChannelsSelectedList(currentSettings.channelSelectionMode as 'all' | 'button');

  // ===== HOME ASSISTANT SECTION =====
  const haSection = settings.addSection('homeassistant')
    .setName('Home Assistant Integration');

  // HA Discovery Toggle
  settings.addSwitch('homeAssistantEnabled')
    .setLabel('Enable Home Assistant Discovery')
    .setValue(currentSettings.homeAssistantEnabled)
    .setDesc('Automatically create sensors in Home Assistant')
    .onChange((data) => {
      localSettings.homeAssistantEnabled = data.value;
      // Update info text based on state
      if (data.value) {
        haInfoText.setText(HA_ON_TEXT);
        haInfoText.setStyle('info');
      } else {
        haInfoText.setText(HA_OFF_TEXT);
        haInfoText.setStyle('default');
      }
      autosave();
    });

  // HA Info Text
  const haInfoText = settings.addInfo('haInfo')
    .setText(currentSettings.homeAssistantEnabled
      ? HA_ON_TEXT
      : HA_OFF_TEXT)
    .setStyle(currentSettings.homeAssistantEnabled ? 'info' : 'default');

  // ===== STARTUP SECTION =====
  const startupSection = settings.addSection('startup')
    .setName('Startup Settings');

  // Auto Connect
  settings.addSwitch('autoConnect')
    .setLabel('Auto Connect on Startup')
    .setValue(currentSettings.autoConnect)
    .setDesc('Automatically connect when plugin loads')
    .onChange((data) => {
      localSettings.autoConnect = data.value;
      autosave();
    });

  // Return reference to status badge and connection button for external updates
  return {
    statusBadge,
    connectionButton,
    updateConnectionState: (state: ConnectionState) => {
      statusBadge.setText(getStatusText(state));
      statusBadge.setStyle(getStatusStyle(state));
      connectionButton.setTitle(getButtonTitle(state));
      connectionButton.setStyle(getButtonStyle(state));
    },
    updateChannelsSelectedList: () => {
      updateChannelsSelectedList(localSettings.channelSelectionMode as 'all' | 'button' || currentSettings.channelSelectionMode);
    }
  };
}

const HA_ON_TEXT = 'Each channel appears in Home Assistant as a sensor under one "Dot X" device (via MQTT discovery). Entities show as unavailable while Dot X is closed. Turning this off removes them.';
const HA_OFF_TEXT = 'Home Assistant discovery is disabled. Enable it to automatically create sensor entities.';

function getButtonTitle(state: ConnectionState): string {
  if (state === 'connected') return 'Disconnect';
  if (state === 'connecting') return 'Cancel';
  return 'Connect';
}

function getButtonStyle(state: ConnectionState): 'primary' | 'danger' {
  return state === 'connected' || state === 'connecting' ? 'danger' : 'primary';
}

function getStatusText(state: ConnectionState): string {
  switch (state) {
    case 'disconnected':
      return 'Disconnected';
    case 'connecting':
      return 'Connecting...';
    case 'connected':
      return 'Connected';
    case 'error':
      return 'Error';
    default:
      return 'Unknown';
  }
}

function getStatusStyle(state: ConnectionState): 'success' | 'error' | 'warning' | 'info' | 'muted' {
  switch (state) {
    case 'disconnected':
      return 'muted';
    case 'connecting':
      return 'info';
    case 'connected':
      return 'success';
    case 'error':
      return 'error';
    default:
      return 'muted';
  }
}
