import Plugin, { runPlugin } from "@dotmatrixlabs/dotx-plugin-sdk";
import { MQTTClient } from "./src/mqtt-client";
import { HomeAssistantDiscovery } from "./src/homeassistant";
import { buildSettingsUI } from "./src/settings";
import { MQTTSettings, ConnectionState, DeviceUpdateData } from "./src/types";

export default class MQTTPlugin extends Plugin {
  private settings!: MQTTSettings;
  private mqttClient!: MQTTClient;
  private haDiscovery!: HomeAssistantDiscovery;
  private channelButton: any; // SystemUtilButton handle
  private connectionState: ConnectionState = 'disconnected';
  private settingsUIUpdateFn?: (state: ConnectionState) => void;
  private updateChannelsListFn?: () => void;

  async onLoad() {
    console.log("[MQTT Plugin] Loading...");

    // Initialize config
    this.initConfig();
    this.loadSettings();

    // Initialize MQTT client
    this.mqttClient = new MQTTClient(this.settings);

    // Initialize Home Assistant discovery
    this.haDiscovery = new HomeAssistantDiscovery(
      this.mqttClient,
      this.settings.topicPrefix,
      'DotX Device',
      'dotx_device'
    );

    // Set up connection state callback
    this.mqttClient.onConnectionChange((state, error) => {
      this.connectionState = state;
      console.log(`[MQTT Plugin] Connection state: ${state}`, error || '');

      // Update UI
      if (this.settingsUIUpdateFn) {
        this.settingsUIUpdateFn(state);
      }

      // Show toast notifications
      if (state === 'connected') {
        this.ui.showToast({
          message: 'Connected to MQTT broker',
          type: 'success',
          duration: 3000
        });

        // Publish HA discovery if enabled
        if (this.settings.homeAssistantEnabled) {
          this.publishHomeAssistantDiscovery();
        }
      } else if (state === 'disconnected') {
        this.ui.showToast({
          message: 'Disconnected from MQTT broker',
          type: 'info',
          duration: 3000
        });
      } else if (state === 'error') {
        this.ui.showToast({
          message: `MQTT connection error: ${error || 'Unknown error'}`,
          type: 'error',
          duration: 5000
        });
      }
    });

    // Add system utility button for channel selection (before settings UI)
    this.channelButton = this.actionmapper
      .addSystemUtilButton('mqttChannelSelect')
      .setTitle('MQTT Channel')
      .setIcon('fas fa-lg fa-network-wired')
      .setHidden(this.settings.channelSelectionMode === 'all') // Hide if in "all" mode
      .onClick(({ selected, channel }) => {
        console.log(`[MQTT Plugin] Channel ${channel} ${selected ? 'selected' : 'deselected'}`);
        // Update the settings UI channel list dynamically
        if (this.updateChannelsListFn) {
          this.updateChannelsListFn();
        }
      });

    // Build settings UI
    await this.settingsPage.addSettings((settings) => {
      const ui = buildSettingsUI(
        settings,
        this.settings,
        this.connectionState,
        (newSettings) => this.handleSaveSettings(newSettings),
        () => this.handleConnect(),
        () => this.handleDisconnect(),
        this.channelButton
      );

      // Store update functions for later use
      this.settingsUIUpdateFn = ui.updateConnectionState;
      this.updateChannelsListFn = ui.updateChannelsSelectedList;
    });



    // Listen for device updates
    this.device.onUpdate((data) => {
      this.handleDeviceUpdate(data);
    });

    // Auto-connect if enabled
    if (this.settings.autoConnect) {
      console.log("[MQTT Plugin] Auto-connecting...");
      setTimeout(() => {
        this.handleConnect();
      }, 1000);
    }

    console.log("[MQTT Plugin] Loaded successfully!");
  }

  private async handleDeviceUpdate(data: DeviceUpdateData) {
    // Only process if device is connected
    const deviceConnected = await this.device.isConnected();
    if (!deviceConnected) {
      return;
    }

    // Only process if MQTT client is connected
    if (!this.mqttClient.isConnected()) {
      return;
    }

    // Debug logging to investigate channel indexing issue
    console.log('[MQTT Plugin] Device update received:', {
      changesCount: data.changes.length,
      changes: data.changes.map(c => ({ index: c.index, oldValue: c.oldValue, newValue: c.newValue })),
      valuesCount: data.values.length,
      values: data.values.map((v, i) => ({ arrayIndex: i, value: v.value }))
    });

    // Check if all changes have index 0 (bug workaround)
    const allChangesHaveIndexZero = data.changes.length > 0 && data.changes.every(c => c.index === 0);
    const hasMultipleValues = data.values.length > 1;

    // In 'all' mode: publish all channel values whenever any change occurs
    // This also works around the bug where change.index is always 0
    if (this.settings.channelSelectionMode === 'all') {
      console.log('[MQTT Plugin] "All channels" mode - publishing all values from data.values array');
      for (let i = 0; i < data.values.length; i++) {
        const channelIndex = i;
        const value = data.values[i].value;

        try {
          // Publish to MQTT
          if (this.settings.homeAssistantEnabled) {
            // Use Home Assistant discovery
            await this.haDiscovery.publishState(channelIndex, value);
          } else {
            // Standard MQTT publish
            const topic = `${this.settings.topicPrefix}/channel/${channelIndex}`;
            const payload = JSON.stringify({ value: value.toFixed(2) });
            await this.mqttClient.publish(topic, payload);
          }
        } catch (error) {
          console.error(`[MQTT Plugin] Error publishing channel ${channelIndex}:`, error);
        }
      }
      return; // Exit early since we've published all values
    }

    // Button mode: only publish selected channels that changed
    // If we detect the index bug (all changes are index 0), try to match by value
    if (allChangesHaveIndexZero && hasMultipleValues) {
      console.log('[MQTT Plugin] Detected index bug in button mode - attempting to match changes by value');
      // Try to match each change's newValue with values array to find correct index
      for (const change of data.changes) {
        // Find which channel in values array matches this change's newValue
        const matchingIndex = data.values.findIndex(v => Math.abs(v.value - change.newValue) < 0.01);
        const channelIndex = matchingIndex >= 0 ? matchingIndex : change.index; // Fallback to change.index if no match
        const value = change.newValue;

        console.log(`[MQTT Plugin] Processing change: matched channelIndex=${channelIndex}, value=${value}`);

        // Only publish if this channel is selected
        if (!this.channelButton.isSelected(channelIndex)) {
          continue; // Skip unselected channels
        }

        try {
          if (this.settings.homeAssistantEnabled) {
            await this.haDiscovery.publishState(channelIndex, value);
          } else {
            const topic = `${this.settings.topicPrefix}/channel/${channelIndex}`;
            const payload = JSON.stringify({ value: value.toFixed(2) });
            await this.mqttClient.publish(topic, payload);
          }
        } catch (error) {
          console.error(`[MQTT Plugin] Error publishing channel ${channelIndex}:`, error);
        }
      }
      return; // Exit early
    }

    // Normal processing: iterate through changes (when indices are correct)
    for (const change of data.changes) {
      const channelIndex = change.index;
      const value = change.newValue;

      console.log(`[MQTT Plugin] Processing change: channelIndex=${channelIndex}, value=${value}`);

      // In button mode, only publish selected channels
      if (!this.channelButton.isSelected(channelIndex)) {
        continue; // Skip unselected channels
      }

      try {
        if (this.settings.homeAssistantEnabled) {
          await this.haDiscovery.publishState(channelIndex, value);
        } else {
          const topic = `${this.settings.topicPrefix}/channel/${channelIndex}`;
          const payload = JSON.stringify({ value: value.toFixed(2) });
          await this.mqttClient.publish(topic, payload);
        }
      } catch (error) {
        console.error(`[MQTT Plugin] Error publishing channel ${channelIndex}:`, error);
      }
    }
  }

  private handleSaveSettings(newSettings: MQTTSettings) {
    console.log("[MQTT Plugin] Saving settings...");

    // Update settings
    this.settings = newSettings;
    this.config.set('settings', this.settings);

    // Update MQTT client settings
    this.mqttClient.updateSettings(this.settings);

    // Update HA discovery topic prefix
    this.haDiscovery.updateTopicPrefix(this.settings.topicPrefix);

    // Update button visibility based on channel selection mode
    // Hide button when "publish all" mode is active, show when "button" mode is active
    this.channelButton.setHidden(this.settings.channelSelectionMode === 'all');

    this.ui.showToast({
      message: 'Settings saved successfully',
      type: 'success',
      duration: 1000
    });
  }

  private async handleConnect() {
    console.log("[MQTT Plugin] Connecting to MQTT broker...");

    try {
      await this.mqttClient.connect();
    } catch (error) {
      console.error("[MQTT Plugin] Connection failed:", error);
      // Toast is shown by connection state callback
    }
  }

  private async handleDisconnect() {
    console.log("[MQTT Plugin] Disconnecting from MQTT broker...");

    try {
      // Remove HA discovery if enabled
      if (this.settings.homeAssistantEnabled) {
        await this.haDiscovery.removeAllDiscoveries();
      }

      await this.mqttClient.disconnect();
    } catch (error) {
      console.error("[MQTT Plugin] Disconnect failed:", error);
    }
  }

  private async publishHomeAssistantDiscovery() {
    console.log("[MQTT Plugin] Publishing Home Assistant discovery...");

    // Check if device is connected
    const deviceConnected = await this.device.isConnected();
    if (!deviceConnected) {
      console.log("[MQTT Plugin] Device not connected, skipping HA discovery");
      return;
    }

    try {
      // Get connected device information
      const devices = await this.device.getConnected();
      const deviceInfo = devices.length > 0 ? devices[0] : null;

      if (deviceInfo) {
        console.log("[MQTT Plugin] Publishing HA discovery for device:", deviceInfo.name);

        // Update HA discovery with actual device info
        this.haDiscovery.updateDeviceInfo(deviceInfo.name, deviceInfo.port);
      }

      // Publish discovery for channels 0-4
      const channels = Array.from({ length: 5 }, (_, i) => i);
      await this.haDiscovery.publishDiscoveryForChannels(channels);

      console.log("[MQTT Plugin] Home Assistant discovery published");
    } catch (error) {
      console.error("[MQTT Plugin] Error publishing HA discovery:", error);
    }
  }

  private loadSettings() {
    const savedSettings = this.config.get('settings');

    // Generate random client ID if not set
    const clientId = savedSettings?.clientId || `dotx-mqtt-${Math.random().toString(36).substr(2, 9)}`;

    this.settings = {
      brokerIP: savedSettings?.brokerIP || '192.168.1.100',
      brokerPort: savedSettings?.brokerPort || 1883,
      topicPrefix: savedSettings?.topicPrefix || 'dotx',
      username: savedSettings?.username || '',
      password: savedSettings?.password || '',
      clientId: clientId,
      useSsl: savedSettings?.useSsl || false,
      keepalive: savedSettings?.keepalive || 60,
      qos: savedSettings?.qos || 0,
      cleanSession: savedSettings?.cleanSession !== false,
      autoReconnect: savedSettings?.autoReconnect !== false,
      reconnectInterval: savedSettings?.reconnectInterval || 5,
      publishRateLimit: savedSettings?.publishRateLimit || 100,
      homeAssistantEnabled: savedSettings?.homeAssistantEnabled || false,
      channelSelectionMode: savedSettings?.channelSelectionMode || 'all',
      autoConnect: savedSettings?.autoConnect || false
    };
  }

  private initConfig() {
    this.config.init({
      schema: {
        settings: {
          type: "object",
          properties: {
            brokerIP: {
              type: "string",
              default: "192.168.1.100",
              description: "MQTT broker IP address"
            },
            brokerPort: {
              type: "number",
              default: 1883,
              description: "MQTT broker port"
            },
            topicPrefix: {
              type: "string",
              default: "dotx",
              description: "Base topic prefix"
            },
            username: {
              type: "string",
              default: "",
              description: "MQTT username"
            },
            password: {
              type: "string",
              default: "",
              description: "MQTT password"
            },
            clientId: {
              type: "string",
              default: "",
              description: "MQTT client ID"
            },
            useSsl: {
              type: "boolean",
              default: false,
              description: "Use SSL/TLS"
            },
            keepalive: {
              type: "number",
              default: 60,
              description: "Keepalive interval in seconds"
            },
            qos: {
              type: "number",
              default: 0,
              description: "Quality of Service level"
            },
            cleanSession: {
              type: "boolean",
              default: true,
              description: "Clean session flag"
            },
            autoReconnect: {
              type: "boolean",
              default: true,
              description: "Auto reconnect on connection loss"
            },
            reconnectInterval: {
              type: "number",
              default: 5,
              description: "Reconnect interval in seconds"
            },
            publishRateLimit: {
              type: "number",
              default: 100,
              description: "Publish rate limit in milliseconds"
            },
            homeAssistantEnabled: {
              type: "boolean",
              default: false,
              description: "Enable Home Assistant discovery"
            },
            channelSelectionMode: {
              type: "string",
              default: "all",
              description: "Channel selection mode: all or button"
            },
            autoConnect: {
              type: "boolean",
              default: false,
              description: "Auto connect on startup"
            }
          }
        }
      }
    });
  }

  async onUnload() {
    console.log("[MQTT Plugin] Unloading...");

    try {
      // Remove HA discovery if enabled
      if (this.settings.homeAssistantEnabled && this.mqttClient.isConnected()) {
        await this.haDiscovery.removeAllDiscoveries();
      }

      // Disconnect from MQTT
      await this.mqttClient.disconnect();
    } catch (error) {
      console.error("[MQTT Plugin] Error during unload:", error);
    }

    console.log("[MQTT Plugin] Unloaded");
  }
}

// Run the plugin when executed directly
if (require.main === module) {
  runPlugin(MQTTPlugin);
}
