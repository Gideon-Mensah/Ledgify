const SETTINGS_STORAGE_KEY =
  "ledgify_period_lock_settings";

const HISTORY_STORAGE_KEY =
  "ledgify_period_lock_history";

export const PERIOD_LOCK_AREAS = {
  GLOBAL: "global",
  SALES: "sales",
  PURCHASES: "purchases",
  BANKING: "banking",
  JOURNALS: "journals",
};

const AREA_FIELDS = {
  [PERIOD_LOCK_AREAS.SALES]:
    "salesLockDate",

  [PERIOD_LOCK_AREAS.PURCHASES]:
    "purchasesLockDate",

  [PERIOD_LOCK_AREAS.BANKING]:
    "bankingLockDate",

  [PERIOD_LOCK_AREAS.JOURNALS]:
    "journalsLockDate",
};

const AREA_LABELS = {
  [PERIOD_LOCK_AREAS.GLOBAL]:
    "Accounting",

  [PERIOD_LOCK_AREAS.SALES]:
    "Sales",

  [PERIOD_LOCK_AREAS.PURCHASES]:
    "Purchases",

  [PERIOD_LOCK_AREAS.BANKING]:
    "Banking",

  [PERIOD_LOCK_AREAS.JOURNALS]:
    "Manual journals",
};

const DEFAULT_SETTINGS = {
  globalLockDate: "",

  salesLockDate: "",

  purchasesLockDate: "",

  bankingLockDate: "",

  journalsLockDate: "",

  allowAdministratorOverride:
    true,

  notes: "",

  updatedAt: null,

  updatedBy: null,
};

const createId = () => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID ===
      "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
};

const cloneData = (value) => {
  return JSON.parse(
    JSON.stringify(value)
  );
};

const normaliseDate = (value) => {
  if (!value) {
    return "";
  }

  const text =
    String(value).trim();

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      text
    )
  ) {
    return text;
  }

  const parsedDate =
    new Date(text);

  if (
    Number.isNaN(
      parsedDate.getTime()
    )
  ) {
    return "";
  }

  const year =
    parsedDate.getFullYear();

  const month =
    String(
      parsedDate.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      parsedDate.getDate()
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const validateLockDate = (
  value,
  label
) => {
  if (!value) {
    return "";
  }

  const resolvedDate =
    normaliseDate(value);

  if (!resolvedDate) {
    throw new Error(
      `${label} must be a valid date.`
    );
  }

  return resolvedDate;
};

const readJsonArray = (
  storageKey
) => {
  const storedValue =
    localStorage.getItem(
      storageKey
    );

  if (!storedValue) {
    return [];
  }

  try {
    const parsedValue =
      JSON.parse(
        storedValue
      );

    return Array.isArray(
      parsedValue
    )
      ? parsedValue
      : [];
  } catch (error) {
    console.error(
      `Unable to read ${storageKey}:`,
      error
    );

    return [];
  }
};

const readSettings = () => {
  const storedValue =
    localStorage.getItem(
      SETTINGS_STORAGE_KEY
    );

  if (!storedValue) {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify(
        DEFAULT_SETTINGS
      )
    );

    return cloneData(
      DEFAULT_SETTINGS
    );
  }

  try {
    const parsedSettings =
      JSON.parse(
        storedValue
      );

    return {
      ...cloneData(
        DEFAULT_SETTINGS
      ),

      ...parsedSettings,
    };
  } catch (error) {
    console.error(
      "Unable to read period lock settings:",
      error
    );

    return cloneData(
      DEFAULT_SETTINGS
    );
  }
};

const writeSettings = (
  settings
) => {
  localStorage.setItem(
    SETTINGS_STORAGE_KEY,
    JSON.stringify(
      settings
    )
  );

  return cloneData(settings);
};

const writeHistory = (
  history
) => {
  localStorage.setItem(
    HISTORY_STORAGE_KEY,
    JSON.stringify(
      history
    )
  );

  return history;
};

const getChangedFields = (
  previousSettings,
  nextSettings
) => {
  const fields = [
    {
      key:
        "globalLockDate",

      label:
        "Global accounting lock",
    },

    {
      key:
        "salesLockDate",

      label:
        "Sales lock",
    },

    {
      key:
        "purchasesLockDate",

      label:
        "Purchases lock",
    },

    {
      key:
        "bankingLockDate",

      label:
        "Banking lock",
    },

    {
      key:
        "journalsLockDate",

      label:
        "Manual journals lock",
    },

    {
      key:
        "allowAdministratorOverride",

      label:
        "Administrator override",
    },
  ];

  return fields
    .filter(
      ({ key }) =>
        previousSettings[key] !==
        nextSettings[key]
    )
    .map(
      ({ key, label }) => ({
        field: key,

        label,

        previousValue:
          previousSettings[key] ??
          "",

        newValue:
          nextSettings[key] ??
          "",
      })
    );
};

export const getPeriodLockSettings =
  () => {
    return readSettings();
  };

export const getPeriodLockHistory =
  () => {
    return readJsonArray(
      HISTORY_STORAGE_KEY
    ).sort(
      (first, second) =>
        String(
          second.changedAt ||
            ""
        ).localeCompare(
          String(
            first.changedAt ||
              ""
          )
        )
    );
  };

export const savePeriodLockSettings = (
  values = {},
  {
    changedBy =
      "Current user",
  } = {}
) => {
  const previousSettings =
    readSettings();

  const nextSettings = {
    ...previousSettings,

    globalLockDate:
      validateLockDate(
        values.globalLockDate,
        "Global lock date"
      ),

    salesLockDate:
      validateLockDate(
        values.salesLockDate,
        "Sales lock date"
      ),

    purchasesLockDate:
      validateLockDate(
        values.purchasesLockDate,
        "Purchases lock date"
      ),

    bankingLockDate:
      validateLockDate(
        values.bankingLockDate,
        "Banking lock date"
      ),

    journalsLockDate:
      validateLockDate(
        values.journalsLockDate,
        "Manual journals lock date"
      ),

    allowAdministratorOverride:
      Boolean(
        values.allowAdministratorOverride
      ),

    notes:
      String(
        values.notes || ""
      ).trim(),

    updatedAt:
      new Date().toISOString(),

    updatedBy:
      String(
        changedBy ||
          "Current user"
      ),
  };

  const changes =
    getChangedFields(
      previousSettings,
      nextSettings
    );

  writeSettings(
    nextSettings
  );

  if (changes.length > 0) {
    const history =
      getPeriodLockHistory();

    writeHistory([
      {
        id: createId(),

        changedAt:
          nextSettings.updatedAt,

        changedBy:
          nextSettings.updatedBy,

        notes:
          nextSettings.notes,

        changes,
      },

      ...history,
    ]);
  }

  return cloneData(
    nextSettings
  );
};

export const getEffectiveLockDate = (
  area,
  settings =
    getPeriodLockSettings()
) => {
  const resolvedArea =
    String(
      area ||
        PERIOD_LOCK_AREAS.GLOBAL
    ).toLowerCase();

  const possibleDates = [
    settings.globalLockDate,
  ];

  const areaField =
    AREA_FIELDS[
      resolvedArea
    ];

  if (areaField) {
    possibleDates.push(
      settings[areaField]
    );
  }

  const validDates =
    possibleDates
      .map(normaliseDate)
      .filter(Boolean);

  if (
    validDates.length === 0
  ) {
    return "";
  }

  return validDates.sort(
    (first, second) =>
      second.localeCompare(
        first
      )
  )[0];
};

export const getPeriodLockStatus = (
  transactionDate,
  area,
  {
    allowOverride = false,
  } = {}
) => {
  const resolvedDate =
    normaliseDate(
      transactionDate
    );

  if (!resolvedDate) {
    return {
      isLocked: false,

      isOverridden: false,

      transactionDate: "",

      effectiveLockDate:
        getEffectiveLockDate(
          area
        ),

      area,

      areaLabel:
        AREA_LABELS[area] ||
        "Accounting",

      message:
        "No transaction date was supplied.",
    };
  }

  const settings =
    getPeriodLockSettings();

  const effectiveLockDate =
    getEffectiveLockDate(
      area,
      settings
    );

  const locked =
    Boolean(
      effectiveLockDate &&
        resolvedDate <=
          effectiveLockDate
    );

  const canOverride =
    locked &&
    allowOverride &&
    settings.allowAdministratorOverride;

  const areaLabel =
    AREA_LABELS[area] ||
    "Accounting";

  return {
    isLocked:
      locked &&
      !canOverride,

    isOverridden:
      Boolean(
        canOverride
      ),

    transactionDate:
      resolvedDate,

    effectiveLockDate,

    area,

    areaLabel,

    allowAdministratorOverride:
      settings.allowAdministratorOverride,

    message: locked
      ? `${areaLabel} is locked on or before ${effectiveLockDate}.`
      : `${areaLabel} is open for ${resolvedDate}.`,
  };
};

export const assertDateIsOpen = (
  transactionDate,
  area,
  {
    allowOverride = false,

    action =
      "change this transaction",
  } = {}
) => {
  const status =
    getPeriodLockStatus(
      transactionDate,
      area,
      {
        allowOverride,
      }
    );

  if (status.isLocked) {
    throw new Error(
      `You cannot ${action} because ${status.areaLabel.toLowerCase()} is locked on or before ${status.effectiveLockDate}.`
    );
  }

  return status;
};