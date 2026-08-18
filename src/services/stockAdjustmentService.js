import {
    getProductById,
    setProductStockQuantity,
} from "./productService";

const STORAGE_KEY =
    "ledgify_stock_adjustments";

export const STOCK_ADJUSTMENT_TYPES =
    [
        "Increase",
        "Decrease",
        "Set balance",
    ];

export const STOCK_ADJUSTMENT_REASONS =
    [
        "Opening balance",
        "Purchase receipt",
        "Customer return",
        "Sales return",
        "Invoice sale",
        "Invoice reversal",
        "Bill purchase",
        "Bill reversal",
        "Damaged stock",
        "Lost stock",
        "Stolen stock",
        "Supplier return",
        "Stock count correction",
        "Internal use",
        "Other",

    ];

// Creates id.
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

// Performs the round quantity task.
const roundQuantity = (
    quantity
) => {
    return (
        Math.round(
            ((Number(quantity) || 0) +
                Number.EPSILON) *
            1000
        ) / 1000
    );
};

// Performs the round money task.
const roundMoney = (amount) => {
    return (
        Math.round(
            ((Number(amount) || 0) +
                Number.EPSILON) *
            100
        ) / 100
    );
};

// Normalizes text.
const normaliseText = (value) => {
    return String(value || "")
        .trim()
        .toLowerCase();
};

// Saves adjustments to storage.
const saveAdjustmentsToStorage = (
    adjustments
) => {
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(adjustments)
    );

    return adjustments;
};

// Performs the initialise adjustments task.
const initialiseAdjustments =
    () => {
        const storedAdjustments =
            localStorage.getItem(
                STORAGE_KEY
            );

        if (!storedAdjustments) {
            saveAdjustmentsToStorage(
                []
            );

            return [];
        }

        try {
            const parsedAdjustments =
                JSON.parse(
                    storedAdjustments
                );

            if (
                Array.isArray(
                    parsedAdjustments
                )
            ) {
                return parsedAdjustments;
            }
        } catch (error) {
            console.error(
                "Unable to read stock adjustments:",
                error
            );
        }

        saveAdjustmentsToStorage(
            []
        );

        return [];
    };

// Parses date time.
const parseDateTime = (
    dateValue
) => {
    if (!dateValue) {
        return 0;
    }

    const value =
        String(dateValue);

    const date =
        /^\d{4}-\d{2}-\d{2}$/.test(
            value
        )
            ? new Date(
                `${value}T00:00:00`
            )
            : new Date(value);

    const timestamp =
        date.getTime();

    return Number.isFinite(
        timestamp
    )
        ? timestamp
        : 0;
};

// Gets stock adjustments.
export const getStockAdjustments = ({
    search = "",
    productId = "",
    adjustmentType = "",
    reason = "",
    dateFrom = "",
    dateTo = "",
} = {}) => {
    let adjustments =
        initialiseAdjustments();

    const cleanedSearch =
        normaliseText(search);

    if (cleanedSearch) {
        adjustments =
            adjustments.filter(
                (adjustment) =>
                    [
                        adjustment.productName,
                        adjustment.sku,
                        adjustment.reason,
                        adjustment.reference,
                        adjustment.notes,
                        adjustment.adjustedBy,
                    ].some((value) =>
                        normaliseText(
                            value
                        ).includes(
                            cleanedSearch
                        )
                    )
            );
    }

    if (productId) {
        adjustments =
            adjustments.filter(
                (adjustment) =>
                    String(
                        adjustment.productId
                    ) === String(productId)
            );
    }

    if (adjustmentType) {
        adjustments =
            adjustments.filter(
                (adjustment) =>
                    adjustment.adjustmentType ===
                    adjustmentType
            );
    }

    if (reason) {
        adjustments =
            adjustments.filter(
                (adjustment) =>
                    adjustment.reason ===
                    reason
            );
    }

    if (dateFrom) {
        const fromTimestamp =
            parseDateTime(dateFrom);

        adjustments =
            adjustments.filter(
                (adjustment) =>
                    parseDateTime(
                        adjustment.date
                    ) >= fromTimestamp
            );
    }

    if (dateTo) {
        const toTimestamp =
            parseDateTime(dateTo);

        adjustments =
            adjustments.filter(
                (adjustment) =>
                    parseDateTime(
                        adjustment.date
                    ) <= toTimestamp
            );
    }

    return [...adjustments].sort(
        (
            firstAdjustment,
            secondAdjustment
        ) => {
            const dateDifference =
                parseDateTime(
                    secondAdjustment.date
                ) -
                parseDateTime(
                    firstAdjustment.date
                );

            if (dateDifference !== 0) {
                return dateDifference;
            }

            return (
                parseDateTime(
                    secondAdjustment.createdAt
                ) -
                parseDateTime(
                    firstAdjustment.createdAt
                )
            );
        }
    );
};

// Gets stock adjustment by id.
export const getStockAdjustmentById =
    (adjustmentId) => {
        return (
            initialiseAdjustments().find(
                (adjustment) =>
                    String(
                        adjustment.id
                    ) ===
                    String(adjustmentId)
            ) || null
        );
    };

// Gets stock adjustment summary.
export const getStockAdjustmentSummary =
    () => {
        const adjustments =
            initialiseAdjustments();

        return adjustments.reduce(
            (
                summary,
                adjustment
            ) => {
                const quantityChange =
                    Number(
                        adjustment.quantityChange
                    ) || 0;

                const valueImpact =
                    Number(
                        adjustment.valueImpact
                    ) || 0;

                return {
                    totalAdjustments:
                        summary.totalAdjustments +
                        1,

                    unitsAdded:
                        roundQuantity(
                            summary.unitsAdded +
                            (quantityChange > 0
                                ? quantityChange
                                : 0)
                        ),

                    unitsRemoved:
                        roundQuantity(
                            summary.unitsRemoved +
                            (quantityChange < 0
                                ? Math.abs(
                                    quantityChange
                                )
                                : 0)
                        ),

                    netMovement:
                        roundQuantity(
                            summary.netMovement +
                            quantityChange
                        ),

                    valueImpact:
                        roundMoney(
                            summary.valueImpact +
                            valueImpact
                        ),
                };
            },
            {
                totalAdjustments: 0,
                unitsAdded: 0,
                unitsRemoved: 0,
                netMovement: 0,
                valueImpact: 0,
            }
        );
    };

// Creates stock adjustment.
export const createStockAdjustment =
    (adjustmentData) => {
        const product =
            getProductById(
                adjustmentData.productId
            );

        if (!product) {
            throw new Error(
                "Select a valid product."
            );
        }

        if (
            product.type !== "Product" ||
            !product.trackInventory
        ) {
            throw new Error(
                "The selected item does not have inventory tracking enabled."
            );
        }

        if (
            product.status ===
            "Archived"
        ) {
            throw new Error(
                "Archived products cannot receive stock adjustments."
            );
        }

        const adjustmentType =
            String(
                adjustmentData.adjustmentType ||
                ""
            ).trim();

        if (
            !STOCK_ADJUSTMENT_TYPES.includes(
                adjustmentType
            )
        ) {
            throw new Error(
                "Select a valid adjustment type."
            );
        }

        const reason =
            String(
                adjustmentData.reason || ""
            ).trim();

        if (!reason) {
            throw new Error(
                "Select an adjustment reason."
            );
        }

        const date =
            String(
                adjustmentData.date || ""
            ).trim();

        if (!date) {
            throw new Error(
                "Select an adjustment date."
            );
        }

        const enteredQuantity =
            Number(
                adjustmentData.quantity
            );

        if (
            !Number.isFinite(
                enteredQuantity
            )
        ) {
            throw new Error(
                "Enter a valid quantity."
            );
        }

        if (
            adjustmentType !==
            "Set balance" &&
            enteredQuantity <= 0
        ) {
            throw new Error(
                "The adjustment quantity must be greater than zero."
            );
        }

        if (
            adjustmentType ===
            "Set balance" &&
            enteredQuantity < 0
        ) {
            throw new Error(
                "The counted stock balance cannot be below zero."
            );
        }

        const quantityBefore =
            roundQuantity(
                product.quantityOnHand
            );

        let quantityChange = 0;
        let quantityAfter = 0;

        if (
            adjustmentType ===
            "Increase"
        ) {
            quantityChange =
                roundQuantity(
                    enteredQuantity
                );

            quantityAfter =
                roundQuantity(
                    quantityBefore +
                    quantityChange
                );
        }

        if (
            adjustmentType ===
            "Decrease"
        ) {
            quantityChange =
                roundQuantity(
                    -enteredQuantity
                );

            quantityAfter =
                roundQuantity(
                    quantityBefore +
                    quantityChange
                );
        }

        if (
            adjustmentType ===
            "Set balance"
        ) {
            quantityAfter =
                roundQuantity(
                    enteredQuantity
                );

            quantityChange =
                roundQuantity(
                    quantityAfter -
                    quantityBefore
                );
        }

        if (
            quantityAfter < -0.0005
        ) {
            throw new Error(
                `This adjustment would reduce stock below zero. The current stock quantity is ${quantityBefore}.`
            );
        }

        if (
            Math.abs(
                quantityChange
            ) < 0.0005
        ) {
            throw new Error(
                "This adjustment would not change the current stock quantity."
            );
        }

        const unitCost =
            roundMoney(
                product.purchaseCost
            );

        const valueImpact =
            roundMoney(
                quantityChange *
                unitCost
            );

        const now = new Date();

        const adjustment = {
            id: createId(),

            productId:
                product.id,

            productName:
                product.name,

            sku:
                product.sku,

            date,

            adjustmentType,

            reason,

            enteredQuantity:
                roundQuantity(
                    enteredQuantity
                ),

            quantityChange,

            quantityBefore,

            quantityAfter,

            unitCost,

            valueImpact,

            reference:
                String(
                    adjustmentData.reference ||
                    ""
                ).trim(),

            notes:
                String(
                    adjustmentData.notes || ""
                ).trim(),

            adjustedBy:
                String(
                    adjustmentData.adjustedBy ||
                    "Current user"
                ).trim(),

            createdAt:
                now.toISOString(),
        };

        const adjustments =
            initialiseAdjustments();

        let productWasUpdated =
            false;

        try {
            setProductStockQuantity(
                product.id,
                quantityAfter
            );

            productWasUpdated = true;

            saveAdjustmentsToStorage([
                adjustment,
                ...adjustments,
            ]);

            return adjustment;
        } catch (error) {
            if (productWasUpdated) {
                try {
                    setProductStockQuantity(
                        product.id,
                        quantityBefore
                    );
                } catch (
                rollbackError
                ) {
                    console.error(
                        "Stock adjustment rollback failed:",
                        rollbackError
                    );
                }
            }

            throw error;
        }
    };

// Resets stock adjustments.
export const resetStockAdjustments =
    () => {
        saveAdjustmentsToStorage(
            []
        );

        return [];
    };