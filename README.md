# Dharma Connect

## Overview
Dharma Connect is a comprehensive monorepo designed to manage event registration and payment, registration management, media access, email campaigns, and administrative tasks. It consists of multiple applications and services that work together to provide passwordless, authenticated, eligibility-sensitive access to all aspects of event registration management.

> **Work in Progress Notice:**  
> The applications in this repository are currently being moved from various private repositories and are undergoing refactoring. As a result, the code here is not yet ready for production use. We appreciate your patience and understanding as we work to improve and stabilize the codebase. There are significant improvements and app additions needed to complete its functionality.

## Components

### Apps
- **Admin Dashboard**: A web application for administrators to manage student event registration, view student history, and handle event configurations. Built with Next.js.
- **Student Dashboard**: A web application for students to view videos of past teaching events, access liturgies, register for upcoming events, and manage email preferences. Built with Next.js.
- **Email Agent**: A Python-based service that sends emails to students and manages communication between the system and users. It includes a systemd service file for deployment to an EC2 or other dedicated Linux instance.
- **Email Manager**: A web application for managing email campaigns. Built with Next.js.

### Backend
- **Backend Core**: A shared library that provides database actions and business logic for the applications. It is used by all of the Next.js applications.

### Infrastructure
- **Infrastructure**: Contains deployment configurations and infrastructure as code (e.g., CDK, Terraform) for deploying the applications and services to AWS.

## Getting Started
1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd dharma-connect
   ```

2. **Install dependencies**:
   - For the Admin Dashboard, Student Dashboard, and Email Manager:
     ```bash
     pnpm --filter event-dashboard install
     pnpm --filter student-dashboard install
     pnpm --filter email-manager install     
     ```
   - For the Email Agent:
     ```bash
     cd email-agent
     pip install -r requirements.txt
     ```

3. **Set up environment variables**:
   - Create `.env.local` files in the respective app directories and add the necessary environment variables. See the README's in each of the apps for more info.

4. **Run the applications**:
   - Admin Dashboard:
     ```bash
     pnpm --filter event-dashboard run dev
     ```
   - Student Dashboard:
     ```bash
     pnpm --filter student-dashboard run dev
     ```
   - Email Manager
     ```bash
     pnpm --filter email-manager run dev
     ```
   - Email Agent:
     ```bash
     cd email-agent
     python -m src.main.py
     ```
## License
This project is licensed under the MIT License.
