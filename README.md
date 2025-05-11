# Next.js Dharma Connect Projects

This repository contains a collection of Next.js applications related to the Dharma Connect platform, a suite of event registration and participant management tools managed as a monorepo.

## Repository Structure

This monorepo is organized into the following main directories:

-   **/apps**: Contains the individual Next.js applications.
    -   `student-dashboard`: Dashboard interface for students allowing access to upcoming events, video recordings of previous events, teaching materials (PDFs) access, and overall schedule.
    -   `student-registration`: Handles event registration and payments using Stripe.
    -   `admin-dashboard`: Provides administrative functionalities.
-   **/packages**: Contains shared code, utilities, components, or configurations used across multiple applications within this monorepo.
    -   `shared`: A package containing common utilities (like eligibility logic) and shared UI components and types.
    -   `backend-core`: A package containing common AWS interface and authentication utilities.  

## Tech Stack

-   **Framework:** [Next.js](https://nextjs.org/)
-   **Package Manager:** [pnpm](https://pnpm.io/) (utilizing workspaces)
-   **Build/Task Orchestration:** (Optional but recommended) [Turborepo](https://turbo.build/repo)
-   **UI:** [React](https://react.dev/), [React Bootstrap](https://react-bootstrap.netlify.app/)
-   **Styling:** [Bootstrap](https://getbootstrap.com/) / [Bootswatch](https://bootswatch.com/), Custom CSS
-   **Backend Services (API Routes):** Node.js (within Next.js API routes)
-   **Database:** AWS DynamoDB
-   **Authentication:** JWT, AWS Cognito Identity Pools
-   **Deployment:** [Vercel](https://vercel.com/)

## Getting Started

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd nextjs-dharma-connect
    ```
2.  **Install dependencies:** Ensure you have [pnpm](https://pnpm.io/installation) installed globally (`npm install -g pnpm`). Then run the install command from the root directory (`nextjs-dharma-connect/`):
    ```bash
    pnpm install
    ```
3.  **Set up Environment Variables:** Each application might require its own environment variables. Refer to the `README.md` file within each specific application directory under `/apps` for detailed setup instructions (including creating `.env.local` files). Shared secrets might be configured at the root or per-app as needed.
4.  **Run an Application:** To run a specific application (e.g., `student-dashboard`) in development mode, use the pnpm filter command from the root directory:
    ```bash
    pnpm --filter student-dashboard dev
    ```
    *(Replace `student-dashboard` with the desired application name)*

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

