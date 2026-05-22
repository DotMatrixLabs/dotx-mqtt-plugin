# MQTT Publisher Plugin for Dot X

A Dot X plugin that publishes device slider values to an MQTT broker in real-time with Home Assistant integration support.

## Features

- **Real-time Publishing**: Automatically publishes device slider value changes to MQTT topics
- **Home Assistant Integration**: Built-in MQTT Discovery support for automatic sensor creation
- **Channel Selection**: Use the system utility button to select which channels to publish
- **Rate Limiting**: Configurable rate limiting to prevent broker flooding
- **Authentication**: Support for username/password authentication
- **SSL/TLS**: Secure connections with SSL/TLS support
- **Auto-reconnect**: Automatic reconnection on connection loss
- **QoS Levels**: Configurable Quality of Service (0, 1, or 2)

## Installation

### From Marketplace

Install directly through the Dot X plugin marketplace.

### Manual Installation

1. Download the latest `plugin.zip` from the [Releases](https://github.com/ananords/dotx-mqtt-plugin/releases) page
2. Extract to your Dot X plugins directory
3. Restart Dot X and enable the plugin in plugin settings

## Configuration

### Connection Settings

- **Broker IP Address**: IP address of your MQTT broker (e.g., `192.168.1.100`)
- **Broker Port**: Port number (default: `1883`, SSL: `8883`)
- **Topic Prefix**: Base topic for all messages (default: `dotx`)

### Authentication (Optional)

- **Username / Password**: MQTT broker credentials
- **Client ID**: Unique identifier for this client (auto-generated if not set)

### Advanced Settings

- **Enable SSL/TLS**: Use encrypted connection (remember to change port to 8883)
- **Keepalive Interval**: Seconds between keepalive packets (default: 60)
- **Quality of Service**: QoS 0 / 1 / 2
- **Clean Session**: Start with a clean session
- **Auto Reconnect**: Automatically reconnect on connection loss
- **Reconnect Interval**: Seconds between reconnection attempts (default: 5)
- **Publish Rate Limit**: Minimum milliseconds between publishes (default: 100)

### Channel Selection

- **Send All Channels**: All slider changes are published automatically
- **Use System Util Button**: Use the "MQTT Channels" button in the action mapper to toggle individual channels

### Home Assistant Integration

Enable **Home Assistant Discovery** to automatically create sensor entities in Home Assistant.

When enabled:
- Discovery topic: `homeassistant/sensor/dotx_device/ch{X}/config`
- State topic: `{topic_prefix}/channel/{X}`
- Each sensor shows the slider value as a percentage

## MQTT Topics

### Standard Mode

```
{topic_prefix}/channel/{channel_index}
```

Payload:
```json
{ "value": "75.50" }
```

## Development

```bash
npm install
npm run build   # one-shot build
npm run dev     # watch mode
npm start       # build + run
```

### Release

Push a version tag to trigger the GitHub Actions release workflow:

```bash
# Update version in manifest.json and package.json first
git tag v1.0.0
git push --tags
```

GitHub Actions will build `dist/plugin.zip` and attach it to the release.

## License

MIT
