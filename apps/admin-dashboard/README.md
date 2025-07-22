# Admin Dashboard

This is a [Next.js](https://nextjs.org/) TypeScript application for managing student data and events in the Dharma Connect system.

## Features

- **Student Management**: View and manage student records with real-time updates.
- **Event Management**: Switch between different events and view student participation.
- **Configurable Views**: User-specific, event-translated table views with dynamic columns and conditions.
- **Eligibility Filtering**: Only students eligible for the selected event are shown, with eligibility recalculated on event change or data update.
- **View Conditions**: Each view can define conditions that further filter eligible students.
- **Real-time Updates**: WebSocket integration for live updates to student data.
- **Search Functionality**: Incremental search filters displayed students.
- **Responsive Design**: Works on desktop and mobile devices.

## Core Design

### View System

- The list of available views is user-specific and fetched via `authGetViews()`.
- The default view is "Joined". Users can select other views from a dropdown.
- **View Translation:**  
  Before looking up a view, the code checks the current event’s `config.dashboardViews` map. If a translation exists for the selected view, it is used; otherwise, a user-facing error is displayed.
- **No Fallbacks:**  
  If a view (or its translation) is missing, an error message is shown and no table is displayed. There are no default or fallback columns.
- **View Definitions:**  
  Views are defined in the backend "views table" and include both column definitions and view conditions.

### Eligibility and Data Flow

- On startup, the entire student table is loaded into an in-memory shadow table.
- The eligible students list is created by calling `addEligible()` for each student, based on the current event.
- The eligible list is rebuilt when:
  - A new event is selected.
  - A websocket update occurs.
- **View conditions** are always applied to the eligible list before display.
- **Incremental search** further filters the displayed students.

### WebSocket Integration

- The dashboard listens for real-time updates via WebSocket.
- On receiving a message of type `studentUpdate`:
  - The in-memory student table is updated.
  - Eligibility is re-checked for the affected student.
  - View conditions and search are re-applied.
- **WebSocket message format:**
  ```json
  {
    "type": "studentUpdate",
    "id": "<studentId>",
    "eventName": "<INSERT|MODIFY|REMOVE>",
    "newImage": { ... } // DynamoDB NewImage format
  }
  ```

### Error Handling

- If a view or its translation is missing, the message `View '<name>' not found` is displayed and no table is shown.
- No fallback columns or default views are used.

## Technology Stack

- **Frontend:** Next.js (TypeScript)
- **UI Framework:** React Bootstrap
- **State Management:** React Hooks
- **API:** RESTful API via sharedFrontend package
- **Real-time:** WebSocket integration
- **Styling:** Bootstrap CSS with custom components

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm

### Installation

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Set up environment variables in `.env.local`:
   ```
   NEXT_PUBLIC_API_URL=http://localhost:3001
   NEXT_PUBLIC_STUDENT_HISTORY_URL=http://localhost:3002
   ```

3. Run the development server:
   ```bash
   pnpm dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

- **Event Selection:** Choose which event to view student data for.
- **View Selection:** Switch between different table views (e.g., Joined, Eligible).
- **Search:** Search for students by name or email.
- **Table Features:** Sorting, checkboxes, inline editing, and real-time updates.

## Architecture

- **DataTable:** Custom table component for displaying student data.
- **EventSelection:** Dropdown for selecting events.
- **ViewSelection:** Dropdown for selecting table views.
- **WebSocket Handling:** Updates in-memory data and triggers eligibility/view re-evaluation.

## Environment Variables

| Variable                        | Description                        | Required |
|----------------------------------|------------------------------------|----------|
| `NEXT_PUBLIC_API_URL`            | Base URL for API calls             | Yes      |
| `NEXT_PUBLIC_STUDENT_HISTORY_URL`| URL for student history pages      | No       |

## Troubleshooting

- **WebSocket Connection Failed:** Check if the backend WebSocket service is running.
- **API Calls Failing:** Verify `NEXT_PUBLIC_API_URL` is set correctly.
- **TypeScript Errors:** Run `pnpm install` to ensure all dependencies are installed.

---

If you have further questions about the design or usage, please refer to the code comments or contact the project maintainers.