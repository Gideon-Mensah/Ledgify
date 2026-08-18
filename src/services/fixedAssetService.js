import {
  getAccounts,
} from "./accountService";

import {
  getAccountTransactions,
} from "./accountTransactionsService";
const STORAGE_KEY =
  "ledgify_fixed_assets";

const MONEY_TOLERANCE = 0.005;

const DEFAULT_FIXED_ASSET_ACCOUNT_CODE =
  "150";

const DEFAULT_ACCUMULATED_DEPRECIATION_ACCOUNT_CODE =
  "151";

export const FIXED_ASSET_CATEGORIES = [
  "Computer equipment",
  "Office equipment",
  "Furniture and fittings",
  "Motor vehicles",
  "Plant and machinery",
  "Leasehold improvements",
  "Buildings",
  "Other fixed assets",
];

export const FIXED_ASSET_STATUSES = [
  "Active",
  "Fully depreciated",
  "Disposed",
];

export const DEPRECIATION_METHODS = [
  {
    value: "straight-line",
    label: "Straight line",
  },
];

/*
|--------------------------------------------------------------------------
| General helpers
|--------------------------------------------------------------------------
*/

const cloneData = (value) => {
  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  return JSON.parse(
    JSON.stringify(value)
  );
};

const createRecordId = () => {
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

const roundMoney = (value) => {
  return (
    Math.round(
      ((Number(value) || 0) +
        Number.EPSILON) *
      100
    ) / 100
  );
};

const normaliseText = (value) => {
  return String(value || "")
    .trim()
    .toLowerCase();
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

const getToday = () => {
  const today =
    new Date();

  const year =
    today.getFullYear();

  const month =
    String(
      today.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      today.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${year}-${month}-${day}`;
};

const parseDate = (value) => {
  const resolvedDate =
    normaliseDate(value);

  if (!resolvedDate) {
    return null;
  }

  const parsedDate =
    new Date(
      `${resolvedDate}T00:00:00`
    );

  return Number.isNaN(
    parsedDate.getTime()
  )
    ? null
    : parsedDate;
};

const getMonthDifference = (
  startDate,
  endDate
) => {
  const start =
    parseDate(startDate);

  const end =
    parseDate(endDate);

  if (
    !start ||
    !end ||
    end < start
  ) {
    return 0;
  }

  let months =
    (end.getFullYear() -
      start.getFullYear()) *
    12 +
    (end.getMonth() -
      start.getMonth());

  if (
    end.getDate() >=
    start.getDate()
  ) {
    months += 1;
  }

  return Math.max(
    months,
    0
  );
};

const validatePositiveNumber = (
  value,
  label,
  {
    allowZero = false,
  } = {}
) => {
  const amount =
    Number(value);

  if (
    !Number.isFinite(amount)
  ) {
    throw new Error(
      `${label} must be a valid number.`
    );
  }

  if (
    allowZero
      ? amount < 0
      : amount <= 0
  ) {
    throw new Error(
      allowZero
        ? `${label} cannot be negative.`
        : `${label} must be greater than zero.`
    );
  }

  return roundMoney(amount);
};

/*
|--------------------------------------------------------------------------
| Storage
|--------------------------------------------------------------------------
*/

const initialiseFixedAssets = () => {
  const storedAssets =
    localStorage.getItem(
      STORAGE_KEY
    );

  if (storedAssets) {
    try {
      const parsedAssets =
        JSON.parse(
          storedAssets
        );

      if (
        Array.isArray(
          parsedAssets
        )
      ) {
        return parsedAssets;
      }
    } catch (error) {
      console.error(
        "Unable to read fixed assets:",
        error
      );
    }
  }

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([])
  );

  return [];
};

export const saveFixedAssets = (
  assets
) => {
  if (!Array.isArray(assets)) {
    throw new Error(
      "Fixed assets must be stored as an array."
    );
  }

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(assets)
  );

  return assets;
};

/*
|--------------------------------------------------------------------------
| Asset numbering
|--------------------------------------------------------------------------
*/

const calculateNextAssetNumber = (
  assets
) => {
  const highestNumber =
    assets.reduce(
      (highest, asset) => {
        const numericPart =
          Number(
            String(
              asset.assetNumber ||
              ""
            ).replace(
              /\D/g,
              ""
            )
          );

        if (
          !Number.isFinite(
            numericPart
          )
        ) {
          return highest;
        }

        return Math.max(
          highest,
          numericPart
        );
      },
      0
    );

  return `FA-${String(
    highestNumber + 1
  ).padStart(4, "0")}`;
};

export const getNextFixedAssetNumber =
  () => {
    return calculateNextAssetNumber(
      initialiseFixedAssets()
    );
  };

/*
|--------------------------------------------------------------------------
| Depreciation
|--------------------------------------------------------------------------
*/

export const calculateAssetDepreciation = (
  asset,
  asAtDate = getToday()
) => {
  const cost =
    roundMoney(
      asset?.cost
    );

  const residualValue =
    roundMoney(
      asset?.residualValue
    );

  const usefulLifeYears =
    Number(
      asset?.usefulLifeYears
    ) || 0;

  const totalUsefulLifeMonths =
    Math.max(
      Math.round(
        usefulLifeYears * 12
      ),
      0
    );

  const depreciableAmount =
    roundMoney(
      Math.max(
        cost - residualValue,
        0
      )
    );

  const annualDepreciation =
    usefulLifeYears > 0
      ? roundMoney(
        depreciableAmount /
        usefulLifeYears
      )
      : 0;

  const monthlyDepreciation =
    totalUsefulLifeMonths > 0
      ? roundMoney(
        depreciableAmount /
        totalUsefulLifeMonths
      )
      : 0;

  const depreciationStartDate =
    normaliseDate(
      asset?.depreciationStartDate ||
      asset?.purchaseDate
    );

  const disposed =
    normaliseText(
      asset?.status
    ) === "disposed";

  let calculationDate =
    normaliseDate(
      asAtDate
    ) || getToday();

  if (
    disposed &&
    asset?.disposalDate
  ) {
    const disposalDate =
      normaliseDate(
        asset.disposalDate
      );

    if (
      disposalDate &&
      disposalDate <
      calculationDate
    ) {
      calculationDate =
        disposalDate;
    }
  }

  const elapsedMonths =
    Math.min(
      getMonthDifference(
        depreciationStartDate,
        calculationDate
      ),
      totalUsefulLifeMonths
    );

  const scheduledDepreciation =
    roundMoney(
      monthlyDepreciation *
      elapsedMonths
    );

  const accumulatedDepreciation =
    roundMoney(
      Math.min(
        scheduledDepreciation,
        depreciableAmount
      )
    );

  const netBookValue =
    roundMoney(
      Math.max(
        cost -
        accumulatedDepreciation,
        residualValue
      )
    );

  const remainingDepreciableAmount =
    roundMoney(
      Math.max(
        depreciableAmount -
        accumulatedDepreciation,
        0
      )
    );

  const remainingUsefulLifeMonths =
    Math.max(
      totalUsefulLifeMonths -
      elapsedMonths,
      0
    );

  const fullyDepreciated =
    totalUsefulLifeMonths > 0 &&
    (
      remainingDepreciableAmount <=
      MONEY_TOLERANCE ||
      elapsedMonths >=
      totalUsefulLifeMonths
    );

  return {
    cost,

    residualValue,

    depreciableAmount,

    usefulLifeYears,

    totalUsefulLifeMonths,

    elapsedMonths,

    remainingUsefulLifeMonths,

    annualDepreciation,

    monthlyDepreciation,

    accumulatedDepreciation,

    remainingDepreciableAmount,

    netBookValue,

    depreciationStartDate,

    calculationDate,

    fullyDepreciated,
  };
};

const resolveAssetStatus = (
  asset,
  asAtDate = getToday()
) => {
  const resolvedAsAtDate =
    normaliseDate(
      asAtDate
    ) ||
    getToday();

  const disposalDate =
    normaliseDate(
      asset?.disposalDate
    );

  /*
  |--------------------------------------------------------------------------
  | Historical disposal status
  |--------------------------------------------------------------------------
  |
  | Purchase:  01 Jan
  | Disposal:  01 Sep
  |
  | As at 31 Aug -> asset is still on the register
  | As at 01 Sep -> asset is disposed
  |
  */

  if (
    disposalDate &&
    disposalDate <=
    resolvedAsAtDate
  ) {
    return "Disposed";
  }

  /*
  |--------------------------------------------------------------------------
  | Legacy disposal with no disposal date
  |--------------------------------------------------------------------------
  */

  if (
    !disposalDate &&
    normaliseText(
      asset?.status
    ) === "disposed"
  ) {
    return "Disposed";
  }

  const depreciation =
    calculateAssetDepreciation(
      asset,
      resolvedAsAtDate
    );

  return depreciation.fullyDepreciated
    ? "Fully depreciated"
    : "Active";
};

/*
|--------------------------------------------------------------------------
| Validation and cleaning
|--------------------------------------------------------------------------
*/

const cleanFixedAssetInput = (
  assetData = {},
  existingAsset = {}
) => {
  const assetName =
    assetData.assetName !==
      undefined
      ? String(
        assetData.assetName ||
        ""
      ).trim()
      : String(
        existingAsset.assetName ||
        ""
      ).trim();

  if (!assetName) {
    throw new Error(
      "Enter the asset name."
    );
  }

  const category =
    assetData.category !==
      undefined
      ? String(
        assetData.category ||
        ""
      ).trim()
      : String(
        existingAsset.category ||
        ""
      ).trim();

  if (!category) {
    throw new Error(
      "Select an asset category."
    );
  }

  const purchaseDate =
    assetData.purchaseDate !==
      undefined
      ? normaliseDate(
        assetData.purchaseDate
      )
      : normaliseDate(
        existingAsset.purchaseDate
      );

  if (!purchaseDate) {
    throw new Error(
      "Select a valid purchase date."
    );
  }

  const depreciationStartDate =
    assetData.depreciationStartDate !==
      undefined
      ? normaliseDate(
        assetData.depreciationStartDate
      )
      : normaliseDate(
        existingAsset.depreciationStartDate ||
        purchaseDate
      );

  if (!depreciationStartDate) {
    throw new Error(
      "Select a valid depreciation start date."
    );
  }

  if (
    depreciationStartDate <
    purchaseDate
  ) {
    throw new Error(
      "The depreciation start date cannot be before the purchase date."
    );
  }

  const cost =
    validatePositiveNumber(
      assetData.cost !==
        undefined
        ? assetData.cost
        : existingAsset.cost,
      "Asset cost"
    );

  const residualValue =
    validatePositiveNumber(
      assetData.residualValue !==
        undefined
        ? assetData.residualValue
        : existingAsset.residualValue ||
        0,
      "Residual value",
      {
        allowZero: true,
      }
    );

  if (
    residualValue > cost
  ) {
    throw new Error(
      "The residual value cannot exceed the asset cost."
    );
  }

  const usefulLifeYears =
    Number(
      assetData.usefulLifeYears !==
        undefined
        ? assetData.usefulLifeYears
        : existingAsset.usefulLifeYears
    );

  if (
    !Number.isFinite(
      usefulLifeYears
    ) ||
    usefulLifeYears <= 0
  ) {
    throw new Error(
      "Useful life must be greater than zero."
    );
  }

  const depreciationMethod =
    String(
      assetData.depreciationMethod !==
        undefined
        ? assetData.depreciationMethod
        : existingAsset.depreciationMethod ||
        "straight-line"
    ).trim();

  if (
    depreciationMethod !==
    "straight-line"
  ) {
    throw new Error(
      "Only straight-line depreciation is currently supported."
    );
  }

  return {
    ...cloneData(
      existingAsset
    ),

    ...cloneData(
      assetData
    ),

    assetName,

    description:
      String(
        assetData.description !==
          undefined
          ? assetData.description ||
          ""
          : existingAsset.description ||
          ""
      ).trim(),

    category,

    purchaseDate,

    depreciationStartDate,

    cost,

    residualValue,

    usefulLifeYears,

    depreciationMethod,

    supplierId:
      assetData.supplierId !==
        undefined
        ? assetData.supplierId
        : existingAsset.supplierId ||
        null,

    supplierName:
      String(
        assetData.supplierName !==
          undefined
          ? assetData.supplierName ||
          ""
          : existingAsset.supplierName ||
          ""
      ).trim(),

    serialNumber:
      String(
        assetData.serialNumber !==
          undefined
          ? assetData.serialNumber ||
          ""
          : existingAsset.serialNumber ||
          ""
      ).trim(),

    location:
      String(
        assetData.location !==
          undefined
          ? assetData.location ||
          ""
          : existingAsset.location ||
          ""
      ).trim(),

    notes:
      String(
        assetData.notes !==
          undefined
          ? assetData.notes ||
          ""
          : existingAsset.notes ||
          ""
      ).trim(),

    assetAccountCode:
      String(
        assetData.assetAccountCode !==
          undefined
          ? assetData.assetAccountCode ||
          ""
          : existingAsset.assetAccountCode ||
          ""
      ).trim(),

    accumulatedDepreciationAccountCode:
      String(
        assetData.accumulatedDepreciationAccountCode !==
          undefined
          ? assetData.accumulatedDepreciationAccountCode ||
          ""
          : existingAsset.accumulatedDepreciationAccountCode ||
          ""
      ).trim(),

    depreciationExpenseAccountCode:
      String(
        assetData.depreciationExpenseAccountCode !==
          undefined
          ? assetData.depreciationExpenseAccountCode ||
          ""
          : existingAsset.depreciationExpenseAccountCode ||
          ""
      ).trim(),
  };
};

/*
|--------------------------------------------------------------------------
| Read assets
|--------------------------------------------------------------------------
*/

export const getFixedAssets = (
  {
    search = "",
    category = "",
    status = "",
    asAtDate = getToday(),
  } = {}
) => {
  let assets =
    initialiseFixedAssets().map(
      (asset) => {
        const depreciation =
          calculateAssetDepreciation(
            asset,
            asAtDate
          );

        return {
          ...asset,

          status:
            resolveAssetStatus(
              asset,
              asAtDate
            ),

          depreciation,
        };
      }
    );

  if (category) {
    assets =
      assets.filter(
        (asset) =>
          normaliseText(
            asset.category
          ) ===
          normaliseText(category)
      );
  }

  if (status) {
    assets =
      assets.filter(
        (asset) =>
          normaliseText(
            asset.status
          ) ===
          normaliseText(status)
      );
  }

  const searchValue =
    normaliseText(search);

  if (searchValue) {
    assets =
      assets.filter(
        (asset) =>
          [
            asset.assetNumber,
            asset.assetName,
            asset.description,
            asset.category,
            asset.serialNumber,
            asset.location,
            asset.supplierName,
          ].some((value) =>
            normaliseText(
              value
            ).includes(
              searchValue
            )
          )
      );
  }

  return [...assets].sort(
    (first, second) =>
      String(
        first.assetNumber ||
        ""
      ).localeCompare(
        String(
          second.assetNumber ||
          ""
        ),
        undefined,
        {
          numeric: true,
          sensitivity: "base",
        }
      )
  );
};

export const getFixedAssetRegister =
  getFixedAssets;

export const getFixedAssetById = (
  assetId,
  asAtDate = getToday()
) => {
  const asset =
    initialiseFixedAssets().find(
      (currentAsset) =>
        String(
          currentAsset.id
        ) ===
        String(assetId)
    );

  if (!asset) {
    return null;
  }

  return {
    ...asset,

    status:
      resolveAssetStatus(
        asset,
        asAtDate
      ),

    depreciation:
      calculateAssetDepreciation(
        asset,
        asAtDate
      ),
  };
};

/*
|--------------------------------------------------------------------------
| Create asset
|--------------------------------------------------------------------------
*/

export const createFixedAsset = (
  assetData
) => {
  if (
    !assetData ||
    typeof assetData !==
    "object"
  ) {
    throw new Error(
      "Fixed asset data is required."
    );
  }

  const assets =
    initialiseFixedAssets();

  const cleanedAsset =
    cleanFixedAssetInput(
      assetData
    );

  const assetNumber =
    String(
      assetData.assetNumber ||
      ""
    ).trim() ||
    calculateNextAssetNumber(
      assets
    );

  const duplicateAssetNumber =
    assets.some(
      (asset) =>
        normaliseText(
          asset.assetNumber
        ) ===
        normaliseText(
          assetNumber
        )
    );

  if (duplicateAssetNumber) {
    throw new Error(
      "An asset with this asset number already exists."
    );
  }

  const now =
    new Date().toISOString();

  const newAsset = {
    ...cleanedAsset,

    id:
      assetData.id ||
      createRecordId(),

    assetNumber,

    status: "Active",

    disposalDate: "",

    disposalProceeds: 0,

    disposalReason: "",

    depreciationJournalIds:
      [],

    acquisitionJournalId:
      null,

    disposalJournalId:
      null,

    createdAt:
      assetData.createdAt ||
      now,

    updatedAt: now,
  };

  newAsset.status =
    resolveAssetStatus(
      newAsset
    );

  saveFixedAssets([
    newAsset,
    ...assets,
  ]);

  return getFixedAssetById(
    newAsset.id
  );
};

/*
|--------------------------------------------------------------------------
| Update asset
|--------------------------------------------------------------------------
*/

export const updateFixedAsset = (
  assetId,
  updates
) => {
  const assets =
    initialiseFixedAssets();

  const existingAsset =
    assets.find(
      (asset) =>
        String(asset.id) ===
        String(assetId)
    );

  if (!existingAsset) {
    throw new Error(
      "Fixed asset not found."
    );
  }

  if (
    normaliseText(
      existingAsset.status
    ) === "disposed"
  ) {
    throw new Error(
      "A disposed asset cannot be edited. Reverse the disposal first."
    );
  }

  const cleanedAsset =
    cleanFixedAssetInput(
      updates,
      existingAsset
    );

  const assetNumber =
    String(
      updates?.assetNumber !==
        undefined
        ? updates.assetNumber ||
        ""
        : existingAsset.assetNumber
    ).trim();

  if (!assetNumber) {
    throw new Error(
      "Enter an asset number."
    );
  }

  const duplicateAssetNumber =
    assets.some(
      (asset) =>
        String(asset.id) !==
        String(assetId) &&
        normaliseText(
          asset.assetNumber
        ) ===
        normaliseText(
          assetNumber
        )
    );

  if (duplicateAssetNumber) {
    throw new Error(
      "An asset with this asset number already exists."
    );
  }

  const updatedAsset = {
    ...existingAsset,

    ...cleanedAsset,

    id:
      existingAsset.id,

    assetNumber,

    createdAt:
      existingAsset.createdAt,

    updatedAt:
      new Date().toISOString(),
  };

  updatedAsset.status =
    resolveAssetStatus(
      updatedAsset
    );

  const updatedAssets =
    assets.map((asset) =>
      String(asset.id) ===
        String(assetId)
        ? updatedAsset
        : asset
    );

  saveFixedAssets(
    updatedAssets
  );

  return getFixedAssetById(
    assetId
  );
};

/*
|--------------------------------------------------------------------------
| Dispose asset
|--------------------------------------------------------------------------
*/

export const disposeFixedAsset = (
  assetId,
  {
    disposalDate,
    disposalProceeds = 0,
    disposalReason = "",
  } = {}
) => {
  const assets =
    initialiseFixedAssets();

  const existingAsset =
    assets.find(
      (asset) =>
        String(asset.id) ===
        String(assetId)
    );

  if (!existingAsset) {
    throw new Error(
      "Fixed asset not found."
    );
  }

  if (
    normaliseText(
      existingAsset.status
    ) === "disposed"
  ) {
    throw new Error(
      "This asset has already been disposed."
    );
  }

  const resolvedDisposalDate =
    normaliseDate(
      disposalDate
    );

  if (!resolvedDisposalDate) {
    throw new Error(
      "Select a valid disposal date."
    );
  }

  if (
    resolvedDisposalDate <
    normaliseDate(
      existingAsset.purchaseDate
    )
  ) {
    throw new Error(
      "The disposal date cannot be before the purchase date."
    );
  }

  const resolvedProceeds =
    validatePositiveNumber(
      disposalProceeds,
      "Disposal proceeds",
      {
        allowZero: true,
      }
    );

  const cleanedReason =
    String(
      disposalReason || ""
    ).trim();

  if (!cleanedReason) {
    throw new Error(
      "Enter the reason for disposing of the asset."
    );
  }

  const depreciation =
    calculateAssetDepreciation(
      existingAsset,
      resolvedDisposalDate
    );

  const gainOrLoss =
    roundMoney(
      resolvedProceeds -
      depreciation.netBookValue
    );

  const disposedAsset = {
    ...existingAsset,

    status: "Disposed",

    disposalDate:
      resolvedDisposalDate,

    disposalProceeds:
      resolvedProceeds,

    disposalReason:
      cleanedReason,

    disposalNetBookValue:
      depreciation.netBookValue,

    disposalAccumulatedDepreciation:
      depreciation.accumulatedDepreciation,

    disposalGainOrLoss:
      gainOrLoss,

    updatedAt:
      new Date().toISOString(),
  };

  const updatedAssets =
    assets.map((asset) =>
      String(asset.id) ===
        String(assetId)
        ? disposedAsset
        : asset
    );

  saveFixedAssets(
    updatedAssets
  );

  return getFixedAssetById(
    assetId,
    resolvedDisposalDate
  );
};

export const reverseFixedAssetDisposal = (
  assetId
) => {
  const assets =
    initialiseFixedAssets();

  const existingAsset =
    assets.find(
      (asset) =>
        String(asset.id) ===
        String(assetId)
    );

  if (!existingAsset) {
    throw new Error(
      "Fixed asset not found."
    );
  }

  if (
    normaliseText(
      existingAsset.status
    ) !== "disposed"
  ) {
    throw new Error(
      "This asset is not currently disposed."
    );
  }

  if (
    existingAsset.disposalJournalId &&
    normaliseText(
      existingAsset.disposalJournalStatus
    ) !== "reversed"
  ) {
    throw new Error(
      "Reverse the disposal accounting journal before reopening this asset."
    );
  }
  const reopenedAsset = {
    ...existingAsset,

    status: "Active",

    disposalDate: "",

    disposalProceeds: 0,

    disposalReason: "",

    disposalNetBookValue:
      null,

    disposalAccumulatedDepreciation:
      null,

    disposalGainOrLoss:
      null,

    updatedAt:
      new Date().toISOString(),
  };

  reopenedAsset.status =
    resolveAssetStatus(
      reopenedAsset
    );

  const updatedAssets =
    assets.map((asset) =>
      String(asset.id) ===
        String(assetId)
        ? reopenedAsset
        : asset
    );

  saveFixedAssets(
    updatedAssets
  );

  return getFixedAssetById(
    assetId
  );
};

/*
|--------------------------------------------------------------------------
| Delete asset
|--------------------------------------------------------------------------
*/

export const deleteFixedAsset = (
  assetId
) => {
  const assets =
    initialiseFixedAssets();

  const existingAsset =
    assets.find(
      (asset) =>
        String(asset.id) ===
        String(assetId)
    );

  if (!existingAsset) {
    throw new Error(
      "Fixed asset not found."
    );
  }

  if (
    existingAsset.acquisitionJournalId ||
    existingAsset.disposalJournalId ||
    (
      existingAsset.depreciationJournalIds ||
      []
    ).length > 0
  ) {
    throw new Error(
      "This asset has accounting journals and cannot be deleted."
    );
  }

  if (
    normaliseText(
      existingAsset.status
    ) === "disposed"
  ) {
    throw new Error(
      "Reverse the asset disposal before deleting it."
    );
  }

  const updatedAssets =
    assets.filter(
      (asset) =>
        String(asset.id) !==
        String(assetId)
    );

  saveFixedAssets(
    updatedAssets
  );

  return updatedAssets;
};

/*
|--------------------------------------------------------------------------
| Summary
|--------------------------------------------------------------------------
*/

export const getFixedAssetSummary = (
  asAtDate = getToday()
) => {
  const assets =
    getFixedAssets({
      asAtDate,
    });

  return assets.reduce(
    (summary, asset) => {
      const depreciation =
        asset.depreciation ||
        calculateAssetDepreciation(
          asset,
          asAtDate
        );

      const disposed =
        normaliseText(
          asset.status
        ) === "disposed";

      return {
        totalAssets:
          summary.totalAssets + 1,

        activeAssets:
          summary.activeAssets +
          (
            disposed
              ? 0
              : 1
          ),

        disposedAssets:
          summary.disposedAssets +
          (
            disposed
              ? 1
              : 0
          ),

        fullyDepreciatedAssets:
          summary.fullyDepreciatedAssets +
          (
            normaliseText(
              asset.status
            ) ===
              "fully depreciated"
              ? 1
              : 0
          ),

        totalCost:
          roundMoney(
            summary.totalCost +
            depreciation.cost
          ),

        accumulatedDepreciation:
          roundMoney(
            summary.accumulatedDepreciation +
            depreciation.accumulatedDepreciation
          ),

        netBookValue:
          roundMoney(
            summary.netBookValue +
            depreciation.netBookValue
          ),

        annualDepreciation:
          roundMoney(
            summary.annualDepreciation +
            (
              disposed
                ? 0
                : depreciation.annualDepreciation
            )
          ),
      };
    },
    {
      totalAssets: 0,

      activeAssets: 0,

      disposedAssets: 0,

      fullyDepreciatedAssets: 0,

      totalCost: 0,

      accumulatedDepreciation: 0,

      netBookValue: 0,

      annualDepreciation: 0,
    }
  );
};

/*
|--------------------------------------------------------------------------
| Fixed Asset ledger reconciliation
|--------------------------------------------------------------------------
*/

const getAssetAccountCode = (
  asset
) => {
  return (
    String(
      asset?.assetAccountCode ||
      ""
    ).trim() ||
    DEFAULT_FIXED_ASSET_ACCOUNT_CODE
  );
};

const getAccumulatedDepreciationAccountCode =
  (
    asset
  ) => {
    return (
      String(
        asset?.accumulatedDepreciationAccountCode ||
        ""
      ).trim() ||
      DEFAULT_ACCUMULATED_DEPRECIATION_ACCOUNT_CODE
    );
  };

const assetExistsOnRegisterAtDate =
  (
    asset,
    asAtDate
  ) => {
    const purchaseDate =
      normaliseDate(
        asset?.purchaseDate
      );

    if (
      purchaseDate &&
      purchaseDate >
      asAtDate
    ) {
      return false;
    }

    const disposalDate =
      normaliseDate(
        asset?.disposalDate
      );

    /*
    |--------------------------------------------------------------------------
    | Disposal is effective on the disposal date
    |--------------------------------------------------------------------------
    |
    | Once the disposal journal is effective, both:
    |
    |   Dr accumulated depreciation
    |   Cr fixed asset cost
    |
    | remove the asset's carrying balances from the Balance Sheet.
    |
    */

    if (
      disposalDate &&
      disposalDate <=
      asAtDate
    ) {
      return false;
    }

    /*
    |--------------------------------------------------------------------------
    | Legacy disposed asset with no disposal date
    |--------------------------------------------------------------------------
    */

    if (
      !disposalDate &&
      normaliseText(
        asset?.status
      ) === "disposed"
    ) {
      return false;
    }

    return true;
  };

const getFixedAssetAccounts =
  () => {
    const accounts =
      getAccounts({
        status: "All",
      });

    return Array.isArray(
      accounts
    )
      ? accounts
      : [];
  };

const findAccountByCode = (
  accounts,
  accountCode
) => {
  return (
    accounts.find(
      (
        account
      ) =>
        String(
          account?.code ||
          ""
        ).trim() ===
        String(
          accountCode ||
          ""
        ).trim()
    ) ||
    null
  );
};

const normaliseLedgerBalanceForSide =
  (
    balance,
    balanceSide,
    expectedSide
  ) => {
    const resolvedBalance =
      roundMoney(
        balance
      );

    if (
      Math.abs(
        resolvedBalance
      ) <=
      MONEY_TOLERANCE
    ) {
      return 0;
    }

    const actualSide =
      normaliseText(
        balanceSide
      );

    const requiredSide =
      normaliseText(
        expectedSide
      );

    if (
      actualSide ===
      "debit" ||
      actualSide ===
      "credit"
    ) {
      return roundMoney(
        Math.abs(
          resolvedBalance
        ) *
        (
          actualSide ===
            requiredSide
            ? 1
            : -1
        )
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Fallback
    |--------------------------------------------------------------------------
    |
    | Account Transactions normally provides balanceSide. Preserve the raw
    | balance if older data does not.
    |
    */

    return resolvedBalance;
  };

const getLedgerControlForAccount =
  ({
    accountCode,
    asAtDate,
    expectedSide,
    accounts,
  }) => {
    const account =
      findAccountByCode(
        accounts,
        accountCode
      );

    if (
      !account
    ) {
      return {
        available: false,

        account: null,

        accountId:
          null,

        accountCode,

        accountName:
          "",

        rawLedgerBalance:
          0,

        ledgerBalance:
          0,

        balanceSide:
          expectedSide,

        expectedSide,

        error:
          `Ledger account ${accountCode} was not found.`,
      };
    }

    try {
      const ledger =
        getAccountTransactions({
          accountId:
            account.id,

          fromDate: "",

          toDate:
            asAtDate,

          search: "",
        });

      const rawLedgerBalance =
        roundMoney(
          ledger.closingBalance
        );

      const balanceSide =
        ledger.closingBalanceSide ||
        ledger.accountNormalBalance ||
        expectedSide;

      return {
        available: true,

        account,

        accountId:
          account.id,

        accountCode:
          account.code,

        accountName:
          account.name,

        rawLedgerBalance,

        ledgerBalance:
          normaliseLedgerBalanceForSide(
            rawLedgerBalance,
            balanceSide,
            expectedSide
          ),

        balanceSide,

        expectedSide,

        error: "",
      };
    } catch (
    controlError
    ) {
      return {
        available: false,

        account,

        accountId:
          account.id,

        accountCode:
          account.code,

        accountName:
          account.name,

        rawLedgerBalance:
          0,

        ledgerBalance:
          0,

        balanceSide:
          expectedSide,

        expectedSide,

        error:
          controlError.message ||
          `Ledger account ${accountCode} could not be reconciled.`,
      };
    }
  };

const addRegisterAmount = (
  map,
  {
    accountCode,
    amount,
    assetId,
  }
) => {
  const resolvedCode =
    String(
      accountCode ||
      ""
    ).trim();

  if (
    !resolvedCode
  ) {
    return;
  }

  const current =
    map.get(
      resolvedCode
    ) || {
      accountCode:
        resolvedCode,

      registerBalance:
        0,

      assetIds:
        [],
    };

  current.registerBalance =
    roundMoney(
      current.registerBalance +
      Number(
        amount || 0
      )
    );

  if (
    assetId !==
    undefined &&
    assetId !==
    null &&
    assetId !==
    ""
  ) {
    current.assetIds.push(
      assetId
    );
  }

  map.set(
    resolvedCode,
    current
  );
};

const ensureControlAccountGroup =
  (
    map,
    accountCode,
    accounts
  ) => {
    const existingAccount =
      findAccountByCode(
        accounts,
        accountCode
      );

    /*
    |--------------------------------------------------------------------------
    | Include default control accounts even with no register assets
    |--------------------------------------------------------------------------
    |
    | This allows Ledgify to detect:
    |
    |   ledger 150 = £5,000
    |   asset register = £0
    |
    | rather than silently reporting no reconciliation.
    |
    */

    if (
      existingAccount &&
      !map.has(
        accountCode
      )
    ) {
      map.set(
        accountCode,
        {
          accountCode,

          registerBalance:
            0,

          assetIds:
            [],
        }
      );
    }
  };

const buildReconciliationRows =
  ({
    groups,
    accounts,
    asAtDate,
    expectedSide,
  }) => {
    return [
      ...groups.values(),
    ]
      .sort(
        (
          first,
          second
        ) =>
          String(
            first.accountCode
          ).localeCompare(
            String(
              second.accountCode
            ),
            undefined,
            {
              numeric: true,
              sensitivity:
                "base",
            }
          )
      )
      .map(
        (
          group
        ) => {
          const control =
            getLedgerControlForAccount({
              accountCode:
                group.accountCode,

              asAtDate,

              expectedSide,

              accounts,
            });

          const difference =
            control.available
              ? roundMoney(
                group.registerBalance -
                control.ledgerBalance
              )
              : 0;

          return {
            accountId:
              control.accountId,

            accountCode:
              group.accountCode,

            accountName:
              control.accountName,

            registerBalance:
              roundMoney(
                group.registerBalance
              ),

            ledgerBalance:
              roundMoney(
                control.ledgerBalance
              ),

            rawLedgerBalance:
              control.rawLedgerBalance,

            ledgerBalanceSide:
              control.balanceSide,

            expectedSide,

            difference,

            isReconciled:
              control.available &&
              Math.abs(
                difference
              ) <=
              MONEY_TOLERANCE,

            available:
              control.available,

            error:
              control.error,

            assetCount:
              group.assetIds.length,

            assetIds:
              [
                ...group.assetIds,
              ],
          };
        }
      );
  };

export const getFixedAssetReconciliation =
  (
    asAtDate = getToday()
  ) => {
    const resolvedAsAtDate =
      normaliseDate(
        asAtDate
      );

    if (
      !resolvedAsAtDate
    ) {
      throw new Error(
        "Select a valid fixed asset reconciliation date."
      );
    }

    const storedAssets =
      initialiseFixedAssets();

    const accounts =
      getFixedAssetAccounts();

    /*
    |--------------------------------------------------------------------------
    | Register position at reporting date
    |--------------------------------------------------------------------------
    */

    const registerAssets =
      storedAssets
        .filter(
          (
            asset
          ) =>
            assetExistsOnRegisterAtDate(
              asset,
              resolvedAsAtDate
            )
        )
        .map(
          (
            asset
          ) => {
            const depreciation =
              calculateAssetDepreciation(
                asset,
                resolvedAsAtDate
              );

            const assetAccountCode =
              getAssetAccountCode(
                asset
              );

            const accumulatedDepreciationAccountCode =
              getAccumulatedDepreciationAccountCode(
                asset
              );

            return {
              ...asset,

              assetAccountCode,

              accumulatedDepreciationAccountCode,

              depreciation,

              reconciliationCost:
                depreciation.cost,

              reconciliationAccumulatedDepreciation:
                depreciation.accumulatedDepreciation,

              reconciliationNetBookValue:
                roundMoney(
                  depreciation.cost -
                  depreciation.accumulatedDepreciation
                ),

              usedDefaultAssetAccount:
                !String(
                  asset.assetAccountCode ||
                  ""
                ).trim(),

              usedDefaultAccumulatedDepreciationAccount:
                !String(
                  asset.accumulatedDepreciationAccountCode ||
                  ""
                ).trim(),
            };
          }
        );

    /*
    |--------------------------------------------------------------------------
    | Register totals by ledger account
    |--------------------------------------------------------------------------
    */

    const assetAccountGroups =
      new Map();

    const accumulatedDepreciationGroups =
      new Map();

    registerAssets.forEach(
      (
        asset
      ) => {
        addRegisterAmount(
          assetAccountGroups,
          {
            accountCode:
              asset.assetAccountCode,

            amount:
              asset.reconciliationCost,

            assetId:
              asset.id,
          }
        );

        addRegisterAmount(
          accumulatedDepreciationGroups,
          {
            accountCode:
              asset.accumulatedDepreciationAccountCode,

            amount:
              asset.reconciliationAccumulatedDepreciation,

            assetId:
              asset.id,
          }
        );
      }
    );

    /*
    |--------------------------------------------------------------------------
    | Always inspect standard Ledgify asset control accounts when they exist
    |--------------------------------------------------------------------------
    */

    ensureControlAccountGroup(
      assetAccountGroups,
      DEFAULT_FIXED_ASSET_ACCOUNT_CODE,
      accounts
    );

    ensureControlAccountGroup(
      accumulatedDepreciationGroups,
      DEFAULT_ACCUMULATED_DEPRECIATION_ACCOUNT_CODE,
      accounts
    );

    const assetAccountRows =
      buildReconciliationRows({
        groups:
          assetAccountGroups,

        accounts,

        asAtDate:
          resolvedAsAtDate,

        expectedSide:
          "Debit",
      });

    const accumulatedDepreciationAccountRows =
      buildReconciliationRows({
        groups:
          accumulatedDepreciationGroups,

        accounts,

        asAtDate:
          resolvedAsAtDate,

        expectedSide:
          "Credit",
      });

    /*
    |--------------------------------------------------------------------------
    | Fixed Asset Register totals
    |--------------------------------------------------------------------------
    */

    const registerCost =
      roundMoney(
        registerAssets.reduce(
          (
            total,
            asset
          ) =>
            total +
            asset.reconciliationCost,
          0
        )
      );

    const registerAccumulatedDepreciation =
      roundMoney(
        registerAssets.reduce(
          (
            total,
            asset
          ) =>
            total +
            asset.reconciliationAccumulatedDepreciation,
          0
        )
      );

    const registerNetBookValue =
      roundMoney(
        registerCost -
        registerAccumulatedDepreciation
      );

    /*
    |--------------------------------------------------------------------------
    | General Ledger totals
    |--------------------------------------------------------------------------
    */

    const assetLedgerBalance =
      roundMoney(
        assetAccountRows.reduce(
          (
            total,
            row
          ) =>
            total +
            (
              row.available
                ? row.ledgerBalance
                : 0
            ),
          0
        )
      );

    const accumulatedDepreciationLedgerBalance =
      roundMoney(
        accumulatedDepreciationAccountRows.reduce(
          (
            total,
            row
          ) =>
            total +
            (
              row.available
                ? row.ledgerBalance
                : 0
            ),
          0
        )
      );

    const ledgerNetBookValue =
      roundMoney(
        assetLedgerBalance -
        accumulatedDepreciationLedgerBalance
      );

    /*
    |--------------------------------------------------------------------------
    | Reconciliation differences
    |--------------------------------------------------------------------------
    */

    const assetCostDifference =
      roundMoney(
        registerCost -
        assetLedgerBalance
      );

    const accumulatedDepreciationDifference =
      roundMoney(
        registerAccumulatedDepreciation -
        accumulatedDepreciationLedgerBalance
      );

    const netBookValueDifference =
      roundMoney(
        registerNetBookValue -
        ledgerNetBookValue
      );

    const accountRows = [
      ...assetAccountRows,
      ...accumulatedDepreciationAccountRows,
    ];

    const unavailableRows =
      accountRows.filter(
        (
          row
        ) =>
          !row.available
      );

    const reconciliationAvailable =
      unavailableRows.length ===
      0;

    const isReconciled =
      reconciliationAvailable &&
      Math.abs(
        assetCostDifference
      ) <=
      MONEY_TOLERANCE &&
      Math.abs(
        accumulatedDepreciationDifference
      ) <=
      MONEY_TOLERANCE &&
      Math.abs(
        netBookValueDifference
      ) <=
      MONEY_TOLERANCE;

    /*
    |--------------------------------------------------------------------------
    | Diagnostics
    |--------------------------------------------------------------------------
    */

    const assetsUsingDefaultAssetAccount =
      registerAssets.filter(
        (
          asset
        ) =>
          asset.usedDefaultAssetAccount
      );

    const assetsUsingDefaultAccumulatedDepreciationAccount =
      registerAssets.filter(
        (
          asset
        ) =>
          asset.usedDefaultAccumulatedDepreciationAccount
      );

    const assetsWithoutAcquisitionJournal =
      registerAssets.filter(
        (
          asset
        ) =>
          !asset.acquisitionJournalId
      );

    const futureAssetsExcluded =
      storedAssets.filter(
        (
          asset
        ) => {
          const purchaseDate =
            normaliseDate(
              asset.purchaseDate
            );

          return (
            purchaseDate &&
            purchaseDate >
            resolvedAsAtDate
          );
        }
      );

    const disposedAssetsExcluded =
      storedAssets.filter(
        (
          asset
        ) => {
          const disposalDate =
            normaliseDate(
              asset.disposalDate
            );

          return (
            disposalDate &&
            disposalDate <=
            resolvedAsAtDate
          );
        }
      );

    const legacyDisposedAssetsWithoutDate =
      storedAssets.filter(
        (
          asset
        ) =>
          normaliseText(
            asset.status
          ) ===
          "disposed" &&
          !normaliseDate(
            asset.disposalDate
          )
      );

    return {
      asAtDate:
        resolvedAsAtDate,

      /*
      |--------------------------------------------------------------------------
      | Register
      |--------------------------------------------------------------------------
      */

      registerAssets,

      registerAssetCount:
        registerAssets.length,

      registerCost,

      registerAccumulatedDepreciation,

      registerNetBookValue,

      /*
      |--------------------------------------------------------------------------
      | General Ledger
      |--------------------------------------------------------------------------
      */

      assetLedgerBalance,

      accumulatedDepreciationLedgerBalance,

      ledgerNetBookValue,

      assetAccountRows,

      accumulatedDepreciationAccountRows,

      /*
      |--------------------------------------------------------------------------
      | Differences
      |--------------------------------------------------------------------------
      */

      assetCostDifference,

      accumulatedDepreciationDifference,

      netBookValueDifference,

      reconciliationAvailable,

      isReconciled,

      /*
      |--------------------------------------------------------------------------
      | Account diagnostics
      |--------------------------------------------------------------------------
      */

      unavailableAccountCount:
        unavailableRows.length,

      unavailableAccountRows:
        unavailableRows,

      reconciliationErrors:
        unavailableRows
          .map(
            (
              row
            ) =>
              row.error
          )
          .filter(Boolean),

      /*
      |--------------------------------------------------------------------------
      | Register diagnostics
      |--------------------------------------------------------------------------
      */

      assetsWithoutAcquisitionJournalCount:
        assetsWithoutAcquisitionJournal.length,

      assetsWithoutAcquisitionJournal,

      defaultAssetAccountMappingCount:
        assetsUsingDefaultAssetAccount.length,

      defaultAccumulatedDepreciationMappingCount:
        assetsUsingDefaultAccumulatedDepreciationAccount.length,

      futureAssetsExcludedCount:
        futureAssetsExcluded.length,

      disposedAssetsExcludedCount:
        disposedAssetsExcluded.length,

      legacyDisposedAssetsWithoutDateCount:
        legacyDisposedAssetsWithoutDate.length,

      hasLegacyDisposedAssetsWithoutDate:
        legacyDisposedAssetsWithoutDate.length >
        0,
    };
  };

/*
|--------------------------------------------------------------------------
| Development reset
|--------------------------------------------------------------------------
*/

export const resetFixedAssets = () => {
  saveFixedAssets([]);

  return [];
};