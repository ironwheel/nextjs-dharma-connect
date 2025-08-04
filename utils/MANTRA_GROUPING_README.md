# Mantra Count Grouping and Pool-Based Access Control

## Overview

The MantraCount component now supports:
1. **Grouping mantras** by adding a `group` field to mantra-config records for better organization
2. **Pool-based access control** using `displayPool` and `writeEnablePool` fields for fine-grained permissions

## How It Works

### 1. Group and Pool Fields in Mantra Config

Add `group`, `displayPool`, and `writeEnablePool` fields to your mantra-config records:

```json
{
  "id": "medicine-buddha",
  "displayNamePrompt": "mantraMedicineBuddhaTitle",
  "descriptionPrompt": "mantraMedicineBuddhaDescription",
  "bgColor": "bg-blue-600",
  "borderColor": "border-blue-500",
  "displayOrder": 1,
  "isActive": true,
  "incrementAmount": 100,
  "displayPool": "daily-practice-pool",
  "writeEnablePool": "daily-practice-write-pool",
  "group": "daily-practice",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### 2. Group Display Logic

- **Grouped Mantras**: Mantras with a `group` field are displayed within bordered sections
- **Ungrouped Mantras**: Mantras without a `group` field (or with `group: null`) are placed in a "default" group
- **Group Descriptions**: Each group displays a description using the prompt key `mantraCountGroup-{groupName}`

### 3. Pool-Based Access Control

- **Display Control**: `displayPool` controls whether a mantra is visible to the user
  - If `displayPool` is specified, the user must be eligible for that pool to see the mantra
  - If `displayPool` is not specified, the mantra is visible to all users
- **Write Control**: `writeEnablePool` controls whether a user can edit their personal counts
  - If `writeEnablePool` is specified, the user must be eligible for that pool to edit counts
  - If `writeEnablePool` is not specified, all users can edit counts
  - When write access is denied, arrow buttons are disabled and grayed out

### 4. Group Description Prompts

Create prompts in your prompts table with the naming convention:
- `mantraCountGroupTitle-daily-practice` → "Daily Practice Mantras"
- `mantraCountGroupDescription-daily-practice` → "These mantras are part of your daily practice routine"
- `mantraCountGroupTitle-special-practices` → "Special Practice Mantras"
- `mantraCountGroupDescription-special-practices` → "These mantras are for special occasions and advanced practices"

## Example Configuration

### Grouped Mantra Config Records with Pool Access Control

```json
[
  {
    "id": "medicine-buddha",
    "displayPool": "daily-practice-pool",
    "writeEnablePool": "daily-practice-write-pool",
    "group": "daily-practice",
    "displayOrder": 1
  },
  {
    "id": "seven-line-supplication", 
    "displayPool": "daily-practice-pool",
    "writeEnablePool": "daily-practice-write-pool",
    "group": "daily-practice",
    "displayOrder": 2
  },
  {
    "id": "condensed-supplication-tara",
    "displayPool": "special-practices-pool",
    "writeEnablePool": "special-practices-write-pool",
    "group": "special-practices", 
    "displayOrder": 3
  },
  {
    "id": "pacifying-turmoil-mamos",
    "displayPool": "special-practices-pool",
    "writeEnablePool": "special-practices-write-pool",
    "group": "special-practices",
    "displayOrder": 4
  },
  {
    "id": "condensed-dispelling-obstacles",
    "displayPool": "special-practices-pool",
    "writeEnablePool": "special-practices-write-pool",
    "group": "special-practices",
    "displayOrder": 5
  }
]
```

### Required Prompts

Add these prompts to your prompts table:

```json
{
  "id": "mantraCountGroupTitle-daily-practice",
  "en": "Daily Practice Mantras",
  "es": "Mantras de Práctica Diaria",
  "fr": "Mantras de Pratique Quotidienne"
},
{
  "id": "mantraCountGroupDescription-daily-practice",
  "en": "These mantras are part of your daily practice routine",
  "es": "Estos mantras son parte de tu rutina de práctica diaria",
  "fr": "Ces mantras font partie de votre routine de pratique quotidienne"
},
{
  "id": "mantraCountGroupTitle-special-practices", 
  "en": "Special Practice Mantras",
  "es": "Mantras de Práctica Especial",
  "fr": "Mantras de Pratique Spéciale"
},
{
  "id": "mantraCountGroupDescription-special-practices",
  "en": "These mantras are for special occasions and advanced practices",
  "es": "Estos mantras son para ocasiones especiales y prácticas avanzadas",
  "fr": "Ces mantras sont pour des occasions spéciales et des pratiques avancées"
}
```

## Visual Layout

The component now displays:

1. **Group Borders**: Each group is surrounded by a gray border
2. **Group Headers**: Group titles and descriptions appear at the top of each bordered section
3. **Grid Layout**: Mantras within each group are displayed in a responsive grid
4. **Default Group**: Ungrouped mantras appear in a "default" group (no header shown)
5. **Access Control**: Arrow buttons are disabled and grayed out when write access is not available

## Implementation Details

### Grouping Function

```typescript
const groupMantraConfigs = (configs: MantraConfig[]): { [groupName: string]: MantraConfig[] } => {
    const groups: { [groupName: string]: MantraConfig[] } = {};
    
    configs.forEach(config => {
        const groupName = config.group || 'default';
        if (!groups[groupName]) {
            groups[groupName] = [];
        }
        groups[groupName].push(config);
    });
    
    // Sort configs within each group by displayOrder
    Object.keys(groups).forEach(groupName => {
        groups[groupName].sort((a, b) => a.displayOrder - b.displayOrder);
    });
    
    return groups;
};
```

### Rendering Logic

- Groups are rendered in the order they appear in the grouped object
- Each group has a border and optional header with title and description
- Mantras within groups maintain their individual styling and functionality
- The "default" group (ungrouped items) doesn't show a header
- Arrow buttons are conditionally enabled/disabled based on write access permissions

## Migration

To add grouping and pool-based access control to existing mantra configs:

1. **Update Records**: Add the `group`, `displayPool`, and `writeEnablePool` fields to existing mantra-config records
2. **Add Prompts**: Create the corresponding group title and description prompts
3. **Configure Pools**: Set up the appropriate pools for display and write access control
4. **Test**: Verify the grouping displays correctly and access control works as expected

## Example Usage

See `mantra-config-records-with-groups.json` for a complete example of grouped mantra configurations. 