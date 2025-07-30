# Student Manager

The Student Manager is a web application for managing user access to various applications in the Dharma Connect monorepo. It provides a centralized interface for administrators to control which students have access to which applications and what permissions they have.

## Features

- **Auth Table Management**: View and manage records in the auth table
- **Student Access Control**: Add, edit, and delete student access records
- **App Permissions**: Configure which applications each student can access
- **Admin Dashboard Configuration**: Set up admin dashboard permissions for each student
- **Access Link Generation**: Generate access links for students to specific applications
- **Search and Filter**: Search through students by name or email
- **Dark Theme**: Modern dark theme with yellow accent colors

## Data Structure

The student-manager manages auth table records with the following structure:

```json
{
  "id": "student-id",
  "adminDashboardConfig": {
    "exportCSV": true,
    "studentHistory": true,
    "viewsProfile": "superuser",
    "writePermission": true
  },
  "permitted-hosts": [
    {
      "actionsProfile": "superuser",
      "host": "localhost"
    },
    {
      "actionsProfile": "admin-dashboard-actions",
      "host": "admin-dashboard.slsupport.link"
    }
  ]
}
```

## Configuration

The app requires the following configuration values in the config table:

- `accessManagerAppList`: List of domain names representing each app
- `accessManagerPool`: Pool name for eligibility checking

## Usage

1. **Viewing Records**: The main table displays all auth records (except the default record)
2. **Adding New Access**: Click "Add New Access" to create a new auth record for a student
3. **Editing Access**: Click the "Edit" button or click on a student name to edit their access
4. **Deleting Access**: Click the "Delete" button to remove a student's access (cannot delete default record)
5. **Searching**: Use the search box to filter students by name or email

## API Integration

The app integrates with the shared backend API and uses the following endpoints:

- `GET /api/table/students` - Fetch all students
- `GET /api/table/auth` - Fetch auth records
- `PUT /api/table/auth/{id}` - Create/update auth record
- `DELETE /api/table/auth/{id}` - Delete auth record
- `POST /api/auth/getLink` - Generate access link

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