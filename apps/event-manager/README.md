# Event Manager

A comprehensive management interface for events and eligibility pools in the Dharma Connect platform.

## Overview

The Event Manager provides a comprehensive interface for managing events, eligibility pools, registration scripts, and offering configurations. All resources can be created, edited, searched, and deleted through an intuitive UI.

## Features

### Event Management
- **Create/Edit Events**: Create new events or edit existing ones with all their configurations
- **Duplicate Events**: Duplicate existing events with automatic year updates and field sanitization
  - Automatically updates year references in aid and name fields
  - Removes read-only fields (embeddedEmails, embeddedVideoList)
  - Resets subevent dates, times, and status flags
  - Validates against conflicts (duplicate aid, name, or subevent dates)
- **Event Fields**: Manage event code (aid), name/description, eligibility pool assignment, script selection, and config options
  - needAcceptance (checkbox, defaults to false)
  - offeringKMFee (checkbox, defaults to true)
  - offeringCADPar (checkbox, defaults to false)
- **SubEvent Management**: Add, edit, and remove subevents within events
  - Date, RCP level, offering mode selection
  - Status flags: eventComplete, eventOnDeck, regLinkAvailable, mediaNotify
- **Search**: Search events by code or name
- **Delete**: Remove events from the system with confirmation modal

### Pool Management
- **Create/Edit Pools**: Create new eligibility pools or edit existing ones
- **Pool Description**: Add/edit descriptions for pools (addressing schema inconsistency)
- **Attributes**: Manage pool attributes (type: pool/oath/join, with name/aid fields)
- **Search**: Search pools by code or description
- **Delete**: Remove pools from the system with confirmation modal

### Script Management
- **Create/Edit Scripts**: Create and manage registration scripts
- **Step Selection**: Select from 58+ available script steps
- **Step Ordering**: Reorder steps using ↑↓ buttons
- **Search**: Search scripts by name
- **Delete**: Remove scripts with confirmation modal

### Offering Management
- **Create/Edit Offerings**: Manage offering configurations
- **Price Levels**: Configure 5 amount levels and corresponding fees
- **Prompts**: Define prompt keys for each offering type
- **Search**: Search offerings by OID
- **Delete**: Remove offerings with confirmation modal

### Schema Information

#### Event Schema
- `aid` (string, required): Event code (e.g., "vt2025")
- `name` (string, required): Event description (e.g., "Vermont In-Person Retreats 2025")
- `config` (object): Configuration including:
  - `pool` (string): Assigned eligibility pool code
  - `lambda-url` (string, read-only): Always set to production lambda URL
  - Various other configuration fields
- `subEvents` (object): Map of subevent keys to subevent objects
- `embeddedEmails` (object, read-only): Managed by other applications

#### Pool Schema
- `name` (string, required): Pool code (e.g., "refuge-or-oath")
- `description` (string): Human-readable description of the pool
- `attributes` (array): Array of attribute objects:
  - `type` (string): "pool", "oath", or "join"
  - `name` (string): Pool name (when type is "pool")
  - `aid` (string): Event AID (when type is "oath" or "join")

#### SubEvent Schema
- `date` (string): ISO date string
- `eventComplete` (boolean): Whether event is completed (defaults to false)
- `eventOnDeck` (boolean): Whether event is upcoming/active (defaults to false)
- `regLinkAvailable` (boolean): Whether registration link is available (defaults to false)
- `mediaNotify` (boolean): Media notification flag (defaults to false)
- `offeringMode` (string): Offering mode identifier (dropdown from offering-config table)
- `rcpLevel` (number): RCP level requirement
- `timeString` (string): Time information display
- `zoomLink` (string): Zoom meeting link
- `embeddedEmails` (object, read-only): Managed by other applications
- `embeddedVideoList` (array, read-only): Managed by other applications

#### Script Schema
- `name` (string, required): Script identifier (e.g., "path", "SWInPerson")
- `steps` (array): Ordered array of step names from available step definitions

#### Offering Config Schema
- `oid` (string, required): Offering identifier (e.g., "OFFERING-4x-108-gnd-east")
- `amounts` (array): Array of 5 price amounts for different offering levels
- `fees` (array): Array of 5 fees corresponding to each price level
- `prompts` (array): Array of prompt keys to display for this offering

## Schema Inconsistency Note

There is a known schema inconsistency between events and pools:
- **Event records**: `aid` field = event code, `name` field = description
- **Pool records**: `name` field = pool code, `description` field = description

This app addresses this by providing a description field for pools.

## Usage

### Running Locally
```bash
pnpm --filter event-manager dev
```

The app will be available at http://localhost:3000

### Authentication
The app uses the same authentication pattern as other apps in the monorepo, requiring `pid` and `hash` query parameters for authentication.

### Navigation
1. Select between "Events", "Eligibility Pools", "Scripts", and "Offerings" using the resource selector
2. Use the search bar to filter by code or name/description
3. Click on an item to edit it
4. Use the "Create New" button to add new resources
5. For events, you can:
   - Click "📋 Duplicate" to create a copy with automatic year updates
   - Manage subevents through the SubEvents section
   - Click "🗑️ Delete" in the edit modal to remove the event

### Duplicate Event Feature
When duplicating an event:
- Year references (202X) in the aid field are updated to the current year
- If YYYYMMDD format is detected in aid, the date portion becomes "xxxx"
- Year references in the name field are updated to the current year
- SubEvent dates, rcpLevels, and zoom links are cleared
- SubEvent status flags (eventComplete, eventOnDeck, etc.) are reset to false
- Read-only fields (embeddedEmails, embeddedVideoList) are removed
- The system validates that the new aid, name, and subevent dates don't conflict with existing events

## Development Notes

- The app does not use WebSocket connections (as specified in requirements)
- Read-only fields (embeddedEmails, embeddedVideoList, lambda-url) are not editable
- All changes are immediately persisted to DynamoDB
- The lambda-url field is automatically set to the production URL for all events

## Technologies Used

- Next.js 15.3.3
- React 18.3.1
- React Bootstrap
- TypeScript
- Shared Frontend utilities from the monorepo

