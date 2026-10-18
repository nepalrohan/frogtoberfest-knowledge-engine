## Purpose

Delivers the frontend integration management interface for connecting, inspecting, and disconnecting third-party knowledge sources.

## ADDED Requirements

### Requirement: Notion Integration Card Display
The system SHALL display an integration card for Notion showing provider name, icon, connection status badge, connected workspace name and avatar when available, and appropriate action controls.

#### Scenario: Display disconnected state
- **WHEN** an authenticated administrator visits the Integrations page and Notion is not connected
- **THEN** the system SHALL show the Notion card with a "Not Connected" badge and an enabled "Connect Notion" button

#### Scenario: Display connected workspace details
- **WHEN** Notion is actively connected
- **THEN** the system SHALL display the connected workspace name, workspace avatar if available, connection date, a "Connected" badge, and a "Disconnect" button

### Requirement: OAuth Authorization Flow and Redirection
The system SHALL request the authorization URL from the backend upon user trigger and redirect the browser to Notion without storing any sensitive tokens in client storage.

#### Scenario: User clicks connect
- **WHEN** the user clicks "Connect Notion"
- **THEN** the system SHALL show a loading spinner, request the authorization URL from the backend endpoint, and redirect the window location to Notion

#### Scenario: Post-callback status verification and feedback
- **WHEN** the administrator returns to the Integrations page following Notion authorization
- **THEN** the system SHALL parse callback query parameters, display a dismissible feedback alert (success, cancelled, or error), and fetch authoritative connection status from the backend

### Requirement: Disconnection Management
The system SHALL allow an authorized administrator to disconnect an active Notion integration with confirmation and immediate visual feedback.

#### Scenario: Successful workspace disconnection
- **WHEN** the administrator clicks "Disconnect" and confirms the action
- **THEN** the system SHALL invoke the backend disconnect endpoint, transition the status badge to "Not Connected", and show the "Connect Notion" action

### Requirement: Insufficient Permissions Feedback
The system SHALL notify users when connection management operations fail due to missing administrator authorization.

#### Scenario: Unauthorized action attempt
- **WHEN** a non-administrative user attempts to connect or disconnect Notion
- **THEN** the system SHALL display an error alert indicating administrator authorization is required
