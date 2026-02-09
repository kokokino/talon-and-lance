# Spoke App Skeleton

A template for creating new spoke apps and a reference implementation of Hub integration for the [Kokokino](https://www.kokokino.com) ecosystem.

## Overview

The Spoke App Skeleton is a fully functional Meteor application that demonstrates how to integrate with the Kokokino Hub for authentication, billing, and Single Sign‑On (SSO). It serves as both:

1. **A Template** – Ready-to-fork starting point for creating new spoke apps
2. **A Reference Implementation** – Working example of Hub integration patterns
3. **A Demo App** – Functional chat application showing real-time Meteor features

## Architecture

This app follows the Kokokino Hub & Spoke architecture:

- **Hub** – Central authentication and billing system (`kokokino.com`)
- **Spoke** – Independent app that relies on Hub for user management

```
┌─────────────────────────────────────────────────────────────────┐
│                         KOKOKINO HUB                           │
│                        (kokokino.com)                           │
│  • User accounts    • Billing    • SSO tokens    • Spoke API   │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    │ SSO Token
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SPOKE APP SKELETON                           │
│                  (localhost:3010 or your-domain)                │
│  • SSO validation  • Chat demo    • Subscription checks        │
└─────────────────────────────────────────────────────────────────┘
```

## Features

### 1. SSO Integration
- Complete token validation flow from Hub redirects
- Local session management using Meteor Accounts
- Automatic session refresh and expiration handling

### 2. Subscription Management
- Middleware for checking user subscriptions
- Graceful handling of expired/missing subscriptions
- Integration with Hub's subscription API

### 3. Demo Chat Room
- Real-time messaging using Meteor publications and methods
- Messages stored in MongoDB (capped at 100 messages)
- User presence and typing indicators (future enhancement)

### 4. Authentication Pages
- "Not Logged In" page with link to Hub
- "Subscription Required" page with clear instructions
- "Session Expired" page for token expiration

### 5. Modern UI Components
- Built with Mithril.js for lightweight, reactive components
- Styled with Pico CSS for minimal, classless styling
- Responsive design that works on mobile and desktop

## Getting Started

### Prerequisites
- Meteor 3.4+
- Node.js 22.x
- Access to a running Kokokino Hub instance (local or production)

## Preferred Tech Stack
We focus on simplicity as a super‑power:

| Technology | Purpose |
|------------|---------|
| **JavaScript** | Unified language for both server‑side and browser‑side code |
| **Meteor JS v3.4** | Realtime apps, user accounts, and MongoDB integration |
| **Meteor Galaxy** | To deploy our apps in the cloud |
| **Mithril JS v2.3** | General UI, using JavaScript to craft HTML |
| **Pico CSS** | Concise HTML that looks good with minimal effort |
| **Babylon JS v8** | 3D rendering and physics (with Havok JS built‑in) |
| **quave:migrations** | For managing changes to the database |

You can choose a different tech stack but the more we converge on a similar stack, the easier it is to help each other. 

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/kokokino/spoke_app_skeleton.git
   cd spoke_app_skeleton
   ```

2. Install dependencies:
   ```bash
   meteor npm install
   ```

3. Copy the example settings file:
   ```bash
   cp settings.example.json settings.development.json
   ```

4. Configure your settings:
   ```json
   {
     "public": {
       "appName": "Your Spoke App Name",
       "appId": "your_app_id",
       "hubUrl": "http://localhost:3000",
       "requiredProducts": ["base_monthly"]
     },
     "private": {
       "hubApiKey": "your-spoke-api-key-from-hub",
       "hubApiUrl": "http://localhost:3000/api/spoke",
       "hubPublicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
     }
   }
   ```

5. Run the development server:
   ```bash
   meteor --settings settings.development.json --port 3010
   ```

   Migrations run automatically on startup. You should see "Created UsedNonces TTL index" in the logs on first run.

### Running with Local Hub

For local development with the Hub:

1. **Start the Hub** (in another terminal):
   ```bash
   cd ../hub
   meteor --settings settings.development.json
   # Hub runs on http://localhost:3000
   ```

2. **Start the Spoke**:
   ```bash
   cd ../spoke_app_skeleton
   meteor --settings settings.development.json --port 3010
   # Spoke runs on http://localhost:3010
   ```

3. **Access the app**:
   - Visit http://localhost:3000 to log into the Hub
   - Click "Launch" on your spoke app in the Hub
   - You'll be redirected to http://localhost:3010 with SSO token

## Project Structure

```
spoke_app_skeleton/
├── client/
│   ├── main.html          # Main HTML template
│   ├── main.css           # Global styles
│   └── main.js            # Client entry point with routing
├── imports/
│   ├── hub/               # Hub integration utilities
│   │   ├── client.js      # Hub API client
│   │   ├── ssoHandler.js  # SSO token processing
│   │   └── subscriptions.js # Subscription checking
│   ├── ui/
│   │   ├── components/    # Reusable UI components
│   │   │   ├── ChatMessage.js
│   │   │   ├── ChatRoom.js
│   │   │   ├── RequireAuth.js
│   │   │   └── RequireSubscription.js
│   │   ├── layouts/       # Page layouts
│   │   │   └── MainLayout.js
│   │   └── pages/         # Route pages
│   │       ├── HomePage.js
│   │       ├── NotLoggedIn.js
│   │       ├── NoSubscription.js
│   │       ├── SessionExpired.js
│   │       └── SsoCallback.js
│   └── lib/
│       └── collections/   # MongoDB collections
│           └── chatMessages.js
├── server/
│   ├── main.js            # Server entry point
│   ├── accounts.js        # Custom login handlers
│   ├── methods.js         # Meteor methods
│   ├── publications.js    # Data publications
│   ├── indexes.js         # Database indexes (TTL for nonces/cache)
│   └── rateLimiting.js    # DDP rate limiter configuration
├── tests/                 # Test files
├── settings.example.json  # Example configuration
└── package.json           # Dependencies
```

## Key Components

### SSO Handler (`imports/hub/ssoHandler.js`)
Handles token validation from Hub redirects:
- Verifies JWT signatures using Hub's public key
- Checks token expiration and app ID
- Prevents replay attacks using nonce tracking

### Hub API Client (`imports/hub/client.js`)
Makes authenticated requests to Hub API:
- Validates user tokens
- Checks subscription status
- Retrieves user information
- Implements caching for performance

### Subscription Middleware (`imports/ui/components/RequireSubscription.js`)
Higher-order component that:
- Checks if user has required subscriptions
- Redirects to appropriate pages if not
- Re-validates subscriptions periodically
- Shows loading states during checks

### Chat Implementation
Demonstrates Meteor's real-time capabilities:
- **Server-side**: MongoDB-backed message store with publication (auto-caps at 100 messages)
- **Client-side**: Reactive subscription with Mithril components
- **Methods**: Secure message sending with user validation and rate limiting

## Creating Your Own Spoke App

### Step 1: Fork This Repository
Use this skeleton as a starting point for your own spoke app.

### Step 2: Update Configuration
1. Change `appId` in settings to your app's unique identifier
2. Update `appName` to your app's display name
3. Set `requiredProducts` to the product IDs your app needs

### Step 3: Customize Features
1. Replace the demo chat with your app's functionality
2. Add your own collections, methods, and publications
3. Create custom UI components for your app's needs
4. Remove or modify authentication pages as needed

### Step 4: Register with Hub
1. Contact Kokokino administrators to get an API key
2. Provide your app's URL and required products
3. Receive your unique `appId` and API key

### Step 5: Deploy
Deploy to Meteor Galaxy or your preferred hosting:
```bash
meteor deploy your-app.kokokino.com --settings settings.production.json
```

## Development Guidelines

### Code Style
- Follow Meteor v3 async/await patterns (no fibers)
- Use Mithril.js for UI components
- Leverage Pico CSS classes for styling
- Follow security best practices for user input

### Security Considerations
- Never store Hub's private key in your code
- Always validate SSO tokens before creating sessions
- Implement rate limiting on sensitive endpoints
- Sanitize user input before display

### Performance Tips
- Cache subscription checks when appropriate
- Use Meteor's reactive data sources efficiently
- Minimize database queries in publications
- Implement pagination for large data sets

## Testing

Run the test suite:
```bash
meteor test --driver-package meteortesting:mocha
```

Tests cover:
- SSO token validation
- Subscription checking
- Chat message functionality
- Authentication flows

## Troubleshooting

### Common Issues

1. **SSO Token Validation Fails**
   - Ensure Hub's public key is correctly configured
   - Check token expiration (tokens expire after 5 minutes)
   - Verify `appId` matches your spoke's configuration

2. **Cannot Connect to Hub API**
   - Verify `hubApiUrl` is correct in settings
   - Check that your API key is valid
   - Ensure CORS is properly configured on Hub

3. **Subscription Checks Fail**
   - Confirm user has required products in Hub
   - Check that product IDs match between Hub and spoke
   - Verify API responses are being parsed correctly

4. **Chat Messages Not Updating**
   - Ensure user is logged in and has subscription
   - Check browser console for errors
   - Verify Meteor methods and publications are working

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](documentation/CONTRIBUTING.md) for details.

## Related Resources

- [Kokokino](https://www.kokokino.com) – Main platform website
- [Kokokino Hub](https://github.com/kokokino/hub) – Central authentication and billing app
- [Hub & Spoke Strategy](documentation/HUB_SPOKE_STRATEGY.md) – Architecture documentation
- [Conventions](documentation/CONVENTIONS.md) – Coding advice
- [Backlog Beacon](https://github.com/kokokino/backlog_beacon) – Another example spoke app for game collection tracking
- [Meteor Documentation](https://docs.meteor.com/) – Meteor framework guides
- [Mithril.js Documentation](https://mithril.js.org/) – UI framework reference

## License

MIT License – see [LICENSE](LICENSE) file for details.
