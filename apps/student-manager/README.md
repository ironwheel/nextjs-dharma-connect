# Student Manager

The Student Manager is a web application for managing user access to various applications in the Dharma Connect monorepo. It provides a centralized interface for administrators to control which students have access to which applications and what permissions they have.

## Features

- **Dynamic Configuration Management**: Automatically discovers and manages configuration options for all applications
- **Auth Table Management**: View and manage records in the auth table
- **Student Access Control**: Add, edit, and delete student access records
- **App Permissions**: Configure which applications each student can access
- **Dynamic UI Generation**: Automatically renders configuration fields based on discovered schema
- **Access Link Generation**: Generate access links for students to specific applications
- **Search and Filter**: Search through students by name or email
- **Dark Theme**: Modern dark theme with yellow accent colors

## Dynamic Configuration System

The Student Manager now uses a **dynamic configuration system** that automatically discovers available applications and their configuration options from the `default` auth record. This eliminates the need for hard-coded configuration and allows the system to automatically adapt to new applications and configuration fields.

### How It Works

1. **Schema Discovery**: On startup, the app reads the `default` auth record to discover all available hosts and their configuration schemas
2. **Dynamic UI Generation**: Configuration sections are automatically rendered for each discovered application
3. **Smart Field Detection**: Input types (checkbox, dropdown, text) are automatically determined based on the data type of default values
4. **Real-time Updates**: The UI automatically updates when the permitted hosts list changes

### Configuration Schema Structure

The `default` auth record should contain a `config` object with the following structure:

```json
{
  "id": "default",
  "permitted-hosts": ["event-dashboard.slsupport.link", "student-manager.slsupport.link"],
  "config": {
    "event-dashboard.slsupport.link": {
      "exportCSV": false,
      "studentHistory": false,
      "viewsProfile": "",
      "writePermission": false,
      "emailDisplay": false
    },
    "student-manager.slsupport.link": {
      "adminAccess": false,
      "userManagement": false
    }
  }
}
```

### Adding New Configuration Options

**IMPORTANT**: When adding new configuration fields or applications, you must update the `default` auth record first. The Student Manager will automatically discover and display these new options.

#### Steps to Add New Config:

1. **Update Default Record**: Add the new configuration field to the `default` auth record in the `config` object
2. **Set Default Values**: Provide appropriate default values for the new field
3. **Restart or Refresh**: The Student Manager will automatically discover the new configuration options
4. **No Code Changes Required**: The UI will automatically render the new fields with appropriate input types

#### Example: Adding a New App

```json
{
  "id": "default",
  "permitted-hosts": ["event-dashboard.slsupport.link", "new-app.slsupport.link"],
  "config": {
    "event-dashboard.slsupport.link": { ... },
    "new-app.slsupport.link": {
      "featureFlag": true,
      "userRole": "standard",
      "maxConnections": 10
    }
  }
}
```

#### Example: Adding New Fields to Existing App

```json
{
  "config": {
    "event-dashboard.slsupport.link": {
      "exportCSV": false,
      "studentHistory": false,
      "viewsProfile": "",
      "writePermission": false,
      "emailDisplay": false,
      "newFeature": true,        // New boolean field
      "userLevel": "basic"       // New string field
    }
  }
}
```

### Field Type Detection

The system automatically determines input types based on default values:

- **Boolean values** → Checkbox inputs
- **String values** → Text inputs (with special handling for `viewsProfile` → Dropdown)
- **Numeric values** → Number inputs
- **Array values** → Multi-select inputs

## Data Structure

The student-manager manages auth table records with the following structure:

```json
{
  "id": "student-id",
  "permitted-hosts": ["event-dashboard.slsupport.link", "student-manager.slsupport.link"],
  "config": {
    "event-dashboard.slsupport.link": {
      "exportCSV": true,
      "studentHistory": true,
      "viewsProfile": "superuser",
      "writePermission": true,
      "emailDisplay": false
    },
    "student-manager.slsupport.link": {
      "adminAccess": false,
      "userManagement": true
    }
  }
}
```

## Usage

1. **Viewing Records**: The main table displays all auth records (except the default record)
2. **Adding New Access**: Click "Add New Access" to create a new auth record for a student
3. **Editing Access**: Click the "Edit" button or click on a student name to edit their access
4. **Deleting Access**: Click the "Delete" button to remove a student's access (cannot delete default record)
5. **Searching**: Use the search box to filter students by name or email
6. **Configuration Management**: All configuration options are automatically discovered and displayed

## API Integration

The app integrates with the shared backend API and uses the following endpoints:

- `GET /api/table/students` - Fetch all students
- `GET /api/table/auth` - Fetch auth records
- `PUT /api/table/auth/{id}` - Create/update auth record
- `DELETE /api/table/auth/{id}` - Delete auth record
- `POST /api/auth/getLink` - Generate access link
- `POST /api/auth/getConfigValue` - Get configuration values

## Development

To run the student-manager in development mode:

```bash
cd apps/student-manager
npm run dev
```

The app will be available at `http://localhost:3000`.

## Dependencies

- Next.js 15.3.3
- React 18.3.1
- React Bootstrap 2.10.9
- Tailwind CSS 3.4.17
- sharedFrontend package for API integration

## Authentication

The student-manager uses the same authentication system as other apps in the monorepo, requiring a valid PID and hash for access.

## Troubleshooting

### Common Issues

1. **"No default auth record or config found"**: Ensure the `default` auth record exists and has a `config` object
2. **Configuration fields not appearing**: Check that new fields are added to the `default` auth record first
3. **UI not updating**: Refresh the page or restart the app to trigger schema rediscovery

### Best Practices

1. **Always update the default record first** when adding new configuration options
2. **Use descriptive field names** that will display well in the UI
3. **Provide sensible default values** for all new configuration fields
4. **Test configuration changes** in a development environment first 