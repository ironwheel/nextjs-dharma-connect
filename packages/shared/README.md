# @dharma/shared

This package contains shared utilities, components, types, and configurations used across the Next.js applications within the `nextjs-dharma-connect` monorepo.

## Purpose

The goal of this package is to provide a single source of truth for common logic and UI elements, reducing code duplication and improving maintainability across the following applications:

-   `apps/student-dashboard`
-   `apps/student-registration`
-   `apps/admin-dashboard`
-   *(Potentially others)*

## Contents

Currently, this package includes:

-   **Utilities (`src/`):**
    -   `eligible()`: A function to determine student eligibility for events based on predefined pool logic.
    -   *(Add other utilities as they are created)*
-   **Components (`src/components/` - example):**
    -   *(Add shared React components if applicable)*
-   **Types (`src/types/` - example):**
    -   *(Add shared TypeScript types/interfaces if applicable)*

## Usage

Applications within this monorepo should add this package as a dependency in their respective `package.json` files using the workspace protocol:

```json
"dependencies": {
  "@dharma/shared": "workspace:*"
}
Then, import the necessary functions or components:import { eligible /*, other exports */ } from '@dharma/shared';

// Use the imported function
// const isEligible = eligible(poolName, studentData, aid, allPoolsData);

