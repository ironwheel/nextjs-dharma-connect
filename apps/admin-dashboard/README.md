This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, install the dependencies:

```bash
npm install
# or
yarn install
# or
pnpm install
Next, set up your local environment variables.Environment Variables (Local Development)This project requires several environment variables for connecting to AWS services, authentication, email sending, and external APIs. These should not be committed to Git.Create a file named .env.local in the root directory of the project.Add the following content to .env.local, replacing the placeholder values (your-...) with your actual credentials and configuration:# AWS Configuration
AWS_REGION=us-east-1 # Or your preferred AWS region
AWS_COGNITO_IDENTITY_POOL_ID=us-east-1:your-actual-pool-id

# --- Authentication and API Keys (auth.js) ---

# RSA Keys for JWT (Ensure correct formatting for newlines if using PEM strings)
API_RSA_PRIVATE="-----BEGIN RSA PRIVATE KEY-----\nYOUR_PRIVATE_KEY_CONTENT_HERE_WITH_NEWLINES_AS_\\n\n-----END RSA PRIVATE KEY-----"
API_RSA_PUBLIC="-----BEGIN PUBLIC KEY-----\nYOUR_PUBLIC_KEY_CONTENT_HERE_WITH_NEWLINES_AS_\\n\n-----END PUBLIC KEY-----"

# SMTP Credentials for Nodemailer (auth.js)
SMTP_USERNAME="your_actual_smtp_email_address"
SMTP_PASSWORD="your_actual_smtp_password"

# Telize RapidAPI Key for geolocation (auth.js)
TELIZE_RAPIDAPI_KEY="your_actual_telize_rapidapi_key"

# --- Application Domain Configuration (auth.js) ---
# Used for constructing confirmation URLs.
APP_DOMAIN_DEV="http://localhost:3000/"
NEXT_PUBLIC_APP_DOMAIN_PROD="[http://your.domain.com/](http://your.domain.com/)" # Your actual production domain
Important: Make sure .env.local is listed in your .gitignore file to prevent accidentally committing your secrets.Running the Development ServerOnce the environment variables are set up, run the development server:npm run dev
# or
yarn dev
# or
pnpm dev
Open http://localhost:3000 with your browser to see the result. (Note: You will likely need a valid pid query parameter, e.g., http://localhost:3000/?pid=your-test-pid, to access the main dashboard).You can start editing the page by modifying pages/index.js. The page auto-updates as you edit the file.API routes are handled in the pages/api directory.This project uses next/font to automatically optimize and load Inter, a custom Google Font.Learn MoreTo learn more about Next.js, take a look at the following resources:Next.js Documentation - learn about Next.js features and API.Learn Next.js - an interactive Next.js tutorial.You can check out the Next.js GitHub repository - your feedback and contributions are welcome!Deploy on VercelThe easiest way to deploy your Next.js app is to use the Vercel Platform from the creators of Next.js.Vercel Environment Variables SetupBefore deploying, you must configure the same environment variables listed in the .env.local section within your Vercel project settings.Go to your project dashboard on Vercel.Navigate to the "Settings" tab.Click on "Environment Variables" in the left sidebar.For each variable listed in the .env.local example (e.g., AWS_REGION, AWS_COGNITO_IDENTITY_POOL_ID, API_RSA_PRIVATE, SMTP_PASSWORD, etc.), add it here:Enter the variable Name (e.g., AWS_COGNITO_IDENTITY_POOL_ID).Enter the Value (your actual secret credential or configuration value).Important: For sensitive values like API_RSA_PRIVATE, SMTP_PASSWORD, etc., ensure you select the "Secret" type if available, or paste the value carefully. Vercel handles multi-line values well.Choose the environments (Production, Preview, Development) where the variable should be available. For secrets, you typically need them in Production and potentially Preview.Save each variable.Your deployed application will automatically use these variables instead of the ones in .env.local.Check out the Vercel Environment Variables documentation and the [Next.js deployment documentation