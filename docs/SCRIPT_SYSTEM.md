## Script System (apps/register)

### Overview

The register app uses a small, data‑driven "script" engine to drive multi‑step registration flows. An event config specifies which steps to run (and in what order), and the engine renders each step, handles navigation, and persists changes back into the `student` record.

Key goals:
- Steps are **configured**, not hard‑coded per event.
- Text is fully **prompt‑driven** and **language‑aware**.
- Step visibility is controlled by **parameterized conditions** (`showWhen`) instead of ad‑hoc code.
- Eligibility and retreat configuration come from **event config + pools**, not inline logic.

The main pieces live under `apps/register/components/script` and `apps/register/config/stepRegistry.tsx`.

---

### Data flow and context

#### Where scripts come from

In `apps/register/pages/index.tsx`:

- Student/event/prompts/pools are loaded:
  - `students` table → `student`
  - `events` table → `event` (including `event.config`)
  - `prompts` table (filtered by `aid = eventCode` and `aid = 'default'`) → combined `prompts` array
  - `pools` table → `pools` array (eligibility definitions)
- Steps are resolved from the event config:
  - If `event.config.scriptSteps` exists, it is passed directly to `getScriptSteps`.
  - Otherwise, `event.config.scriptName` is used to fetch a `scripts` record whose `steps` field is passed to `getScriptSteps`.

The resulting `ScriptDefinition` and `ScriptContext` are passed to `ScriptEngine`:

```ts
const context: ScriptContext = {
  student: data.student,
  event: data.event,
  config: data.event.config,
  prompts: data.prompts,   // array of prompt rows from Dynamo
  pools: data.pools,       // eligibility pools
  pid: studentPid,
  hash: studentHash,
  onComplete: handleJoinComplete,
};

<ScriptEngine definition={scriptDef} context={context} onChange={handleScriptChange} />
```

`onChange(path, value)` paths are relative to `student` (with an optional `"student."` prefix), and `handleScriptChange` writes into `student` accordingly.

---

### Script types and registry

#### Types (`components/script/types.ts`)

```ts
export type ScriptStepType = 'text' | 'checkbox' | 'radio' | 'custom' | 'marketing_channel' | 'info' | 'wait';

export interface ScriptOption {
  label: string;
  value: any;
}

export type StepConditionConfig =
  | { type: 'fieldEquals'; field: string; value: any }
  | { type: 'fieldOneOf'; field: string; keys: string[] }
  | { type: 'fieldExactlyOneOf'; field: string; keys: string[] }
  | { type: 'fieldNoneOf'; field: string; keys: string[] };

export interface ScriptStep {
  id: string;
  type: ScriptStepType;
  promptKey?: string;             // key into prompts table
  field?: string;                 // path under student (e.g. "programs.ABC.join")
  condition?: (ctx: ScriptContext) => boolean;   // legacy/custom predicate (JS function)
  showWhen?: StepConditionConfig; // data‑driven visibility (recommended)
  options?: ScriptOption[];
  component?: React.ComponentType<any>;          // for type === 'custom'
  validation?: (value: any, ctx: ScriptContext) => string | null;
  defaultValue?: any;
  optional?: boolean;
}

export interface ScriptContext {
  student: any;
  event: any;
  config: any;
  [key: string]: any;  // prompts, pools, pid, hash, onComplete, etc.
}
```

Notes:
- `field` is only used by the generic `text/checkbox/radio` renderers. `custom` steps usually handle their own bindings.
- `showWhen` is the main mechanism for making a step conditional on previous answers.

#### Step registry (`config/stepRegistry.tsx`)

`stepRegistry` is a central map from step IDs to `ScriptStep` definitions and associated React components:

```ts
export const stepRegistry: Record<string, ScriptStep> = {
  writtenTranslation: {
    id: 'writtenTranslation',
    type: 'custom',
    component: RenderWrittenTranslation as any,
    field: 'student.writtenLangPref',
    promptKey: 'writtenTranslation',
  },
  whichRetreats: {
    id: 'whichRetreats',
    type: 'custom',
    component: RenderWhichRetreats as any,
    field: 'student.programs',
    promptKey: 'whichRetreats',
  },
  preferenceNecessity: {
    id: 'preferenceNecessity',
    type: 'custom',
    component: RenderPreferenceNecessity as any,
    field: 'student.programs',
    promptKey: 'preferenceNecessity',
    showWhen: {
      type: 'fieldExactlyOneOf',
      field: 'programs.{{eventCode}}.whichRetreats',
      keys: ['vajrayana1', 'vajrayana2'],
    },
  },
  // ... other steps ...
};
```

##### `getScriptSteps`

`getScriptSteps` turns an array of step keys into concrete `ScriptStep`s:

```ts
/**
 * stepKeys can be:
 *   - 'writtenTranslation'
 *   - { id: 'preferenceNecessity', showWhen: { ... } }
 */
export function getScriptSteps(
  stepKeys: (string | { id: string; showWhen?: StepConditionConfig })[],
): ScriptStep[] {
  return stepKeys.map(entry => {
    const key = typeof entry === 'string' ? entry : entry.id;
    const step = stepRegistry[key];
    if (!step) {
      console.warn('Step definition not found for', key);
      return { id: key, type: 'info', promptKey: `Missing definition for ${key}` } as ScriptStep;
    }
    const base = { ...step };
    if (typeof entry === 'object' && entry.showWhen !== undefined) {
      base.showWhen = entry.showWhen; // override from script record
    }
    return base;
  });
}
```

This means **scripts from the DB can override `showWhen`** per step without changing TS code, simply by using objects instead of plain strings in the `steps` array.

---

### Prompt resolution and language

#### Source of prompts

`index.tsx` loads prompts as **rows** from the `prompts` table:

- `aid = activeEventCode`   → event‑specific prompts
- `aid = 'default'`         → default prompts

They are concatenated into a single array and placed into `context.prompts`.

Each row is of the form:

```json
{
  "prompt": "default-selectLanguage",
  "language": "English",
  "aid": "default",
  "text": "Select Language"
}
```

#### `promptLookup` (register app)

`StepComponents.tsx` defines a local `promptLookup(context, key)` that matches the legacy logic from `lineage/reg/pages/index.js`:

1. Determine language:
   - `language = context.student.writtenLangPref ?? 'English'`.
2. Try **event‑specific** prompt rows:
   - `prompt === eventCode + '-' + key` and `language` match.
3. Fall back to **default** rows:
   - `prompt === 'default-' + key` and `language` or `'universal'`.
4. Special case: `event` and `receiptTitle` are aliases for `'title'`.
5. If not found, render a diagnostic string: `"<eventCode>-<key>-<language>-unknown"`.

Step titles in `ScriptEngine` and most labels in `StepComponents` are driven by `promptLookup(context, promptKey)` so they update when `writtenLangPref` is changed in `RenderWrittenTranslation`.

---

### Step rendering and navigation

#### `ScriptEngine` core

`ScriptEngine` takes a `ScriptDefinition` and `ScriptContext` and drives the form:

- Tracks `currentStepIndex` and a `history` stack for the Back button.
- Uses `getNextValidStepIndex` to skip steps that are not currently applicable.
- Renders different control types based on `step.type`:
  - `custom` → invokes the React component from the registry.
  - `text`, `checkbox`, `radio`, `info` → built‑in basic controls.
- Binds values using `step.field` and the `onChange(path, value)` callback.

The key visibility logic:

```ts
const getNextValidStepIndex = (startIndex: number, direction: 'forward' | 'backward'): number => {
  let index = startIndex;
  const limit = direction === 'forward' ? definition.steps.length : -1;
  const increment = direction === 'forward' ? 1 : -1;

  index += increment;
  while (index !== limit) {
    const step = definition.steps[index];
    const conditionOk = !step.condition || step.condition(context);
    const showWhenOk = !step.showWhen || evaluateStepCondition(step.showWhen, context);
    if (conditionOk && showWhenOk) {
      return index;
    }
    index += increment;
  }
  return -1;
};
```

`evaluateStepCondition` lives in `stepConditions.ts` and operates purely on the **data** in `student` + the configured field path.

#### `showWhen` examples

Field paths are relative to `student` and may include `{{eventCode}}`, which is replaced with `context.event.aid` before evaluation.

- **Show only if previous Yes/No answer is Yes:**

  ```ts
  showWhen: {
    type: 'fieldEquals',
    field: 'inPersonTeachings',
    value: true,
  }
  ```

- **Show only if at least one retreat selected:**

  ```ts
  showWhen: {
    type: 'fieldOneOf',
    field: 'programs.{{eventCode}}.whichRetreats',
    keys: ['mahayana', 'vajrayana1', 'vajrayana2'],
  }
  ```

- **`preferenceNecessity` – exactly one Vajrayana retreat selected:**

  ```ts
  showWhen: {
    type: 'fieldExactlyOneOf',
    field: 'programs.{{eventCode}}.whichRetreats',
    keys: ['vajrayana1', 'vajrayana2'],
  }
  ```

- **Show only if none of a set of flags are set:**

  ```ts
  showWhen: {
    type: 'fieldNoneOf',
    field: 'programs.{{eventCode}}.whichOptionalEvents',
    keys: ['evening', 'weekend'],
  }
  ```

Because `showWhen` is a typed config structure, you avoid hard‑coding "step X depends on step Y" in JS – everything is driven by **paths into the `student` object**.

---

### Checkbox maps and eligibility

Some steps, such as `whichRetreats`, `service`, and `serviceContact`, are driven by event config maps like `whichRetreatsConfig` in the `events` record. These use the `CheckboxMap` helper in `StepComponents.tsx`.

#### Event config example (from `event.config.whichRetreatsConfig`)

```json
"whichRetreatsConfig": {
  "mahayana": {
    "pool": "refuge-or-oath",
    "prompt": "mahayanaRetreat",
    "order": 0
  },
  "vajrayana1": {
    "pool": "oath",
    "prompt": "vajrayana1Retreat",
    "order": 2,
    "retreatFull": true
  },
  "vajrayana2": {
    "pool": "oath",
    "prompt": "vajrayana2Retreat",
    "order": 3
  }
}
```

#### `CheckboxMap` behavior

Given `configKey = 'whichRetreatsConfig'` and `basePath = 'student.programs.<eventCode>'`, `CheckboxMap`:

1. Reads `event.config[configKey]` to get the config entries.
2. Filters entries by:
   - **Eligibility pool** (optional):

     ```ts
     if (obj.pool && eventCode && !checkEligibility(obj.pool, context.student, eventCode, pools)) {
       // student is not eligible → hide this option
     }
     ```

   - **`retreatRequired`** (optional): only show option if the corresponding `whichRetreats` key is selected.
3. Sorts by `order`.
4. Renders a checkbox list:
   - Each option label uses `promptLookup(context, obj.prompt)`, so it is localized.
   - Each checkbox writes to `student.programs[eventCode][mapName][key]`, where `mapName` is `configKey.replace('Config', '')` (e.g. `whichRetreats`).

This lets you keep retreat/role eligibility rules in **pools + event config**, not scattered through React components.

---

### Saving and completion

The last step of a script is typically a `save` step that persists the updated `student` via the shared API.

`RenderSave` in `StepComponents.tsx`:

- Uses `context.pid`, `context.hash`, and `context.onComplete` provided by the page.
- Calls `putTableItem('students', pid, student, pid, hash)` to save the full student record.
- Sets `student.programs[eventCode].join = true`, increments `submitCount`, timestamps `submitTime`, and sets `saved = true`.
- On success, calls `onComplete()`, which moves the main page into the "offer" phase.

The page (`index.tsx`) also performs an optimistic `join` update in `handleJoinComplete` so the UI transitions immediately.

---

### How to add or modify a step

1. **Create or update a render component** in `StepComponents.tsx`:
   - Accepts `{ context, engineOnChange, value? }`.
   - Reads from `context.student` and calls `engineOnChange('student.<path>', newValue)`.
   - Uses `promptLookup(context, 'somePromptKey')` for any text.

2. **Register the step** in `stepRegistry.tsx`:

   ```ts
   myNewStep: {
     id: 'myNewStep',
     type: 'custom',
     component: RenderMyNewStep as any,
     field: 'student.programs',
     promptKey: 'myNewStep',
     showWhen: {
       type: 'fieldEquals',
       field: 'programs.{{eventCode}}.join',
       value: true,
     },
   },
   ```

3. **Add the step to the script**:
   - In `event.config.scriptSteps` (array of strings and/or `{ id, showWhen }` objects), or
   - In the `steps` field of the `scripts` table record referenced by `event.config.scriptName`.

4. **Create prompt rows** in the `prompts` table:
   - At least `default-myNewStep` for each supported language.
   - Any per‑event overrides as `<eventCode>-myNewStep`.

5. **(Optional) Add config** under `event.config` if your step uses a map (e.g. `myNewStepConfig`).

With this pattern, new steps and complex conditional flows can be added by editing **event config and script records**, with only minimal TS changes when introducing completely new control types.

