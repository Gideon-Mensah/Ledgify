import {
    products as defaultProducts,
} from "../data/products";

const STORAGE_KEY =
    "ledgify_products";

// Performs the clone data task.
const cloneData = (data) => {
    return JSON.parse(
        JSON.stringify(data)
    );
};

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

// Normalizes sku.
const normaliseSku = (value) => {
    return String(value || "")
        .trim()
        .toUpperCase();
};

// Performs the to non negative number task.
const toNonNegativeNumber = (
    value,
    fieldName
) => {
    const parsedValue = Number(value);

    if (
        !Number.isFinite(parsedValue) ||
        parsedValue < 0
    ) {
        throw new Error(
            `${fieldName} must be zero or greater.`
        );
    }

    return parsedValue;
};

// Saves products to storage.
const saveProductsToStorage = (
    products
) => {
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(products)
    );

    return products;
};

// Performs the initialise products task.
const initialiseProducts = () => {
    const storedProducts =
        localStorage.getItem(
            STORAGE_KEY
        );

    if (storedProducts) {
        try {
            const parsedProducts =
                JSON.parse(storedProducts);

            if (
                Array.isArray(
                    parsedProducts
                )
            ) {
                return parsedProducts;
            }
        } catch (error) {
            console.error(
                "Unable to read saved products:",
                error
            );
        }
    }

    const initialProducts =
        cloneData(defaultProducts);

    saveProductsToStorage(
        initialProducts
    );

    return initialProducts;
};

// Gets stock status.
const getStockStatus = (
    product
) => {
    if (
        product.type !== "Product" ||
        !product.trackInventory
    ) {
        return "Not tracked";
    }

    const quantity =
        Number(
            product.quantityOnHand
        ) || 0;

    const reorderLevel =
        Number(
            product.reorderLevel
        ) || 0;

    if (quantity <= 0) {
        return "Out of stock";
    }

    if (
        reorderLevel > 0 &&
        quantity <= reorderLevel
    ) {
        return "Low stock";
    }

    return "In stock";
};

// Performs the enrich product task.
const enrichProduct = (
    product
) => {
    const quantityOnHand =
        Number(
            product.quantityOnHand
        ) || 0;

    const purchaseCost =
        Number(
            product.purchaseCost
        ) || 0;

    return {
        ...product,

        stockStatus:
            getStockStatus(product),

        inventoryValue:
            product.type ===
                "Product" &&
                product.trackInventory
                ? roundMoney(
                    quantityOnHand *
                    purchaseCost
                )
                : 0,
    };
};

// Validates product.
const validateProduct = (
    productData,
    existingProduct = null
) => {
    const name = String(
        productData.name ??
        existingProduct?.name ??
        ""
    ).trim();

    const sku = normaliseSku(
        productData.sku ??
        existingProduct?.sku ??
        ""
    );

    const type =
        productData.type ??
        existingProduct?.type ??
        "Product";

    if (!name) {
        throw new Error(
            "Enter a product or service name."
        );
    }

    if (!sku) {
        throw new Error(
            "Enter a unique SKU or item code."
        );
    }

    if (
        ![
            "Product",
            "Service",
        ].includes(type)
    ) {
        throw new Error(
            "Select a valid item type."
        );
    }

    const products =
        initialiseProducts();

    const duplicateSku =
        products.some(
            (product) =>
                normaliseSku(
                    product.sku
                ) === sku &&
                String(product.id) !==
                String(
                    existingProduct?.id ||
                    ""
                )
        );

    if (duplicateSku) {
        throw new Error(
            "Another product or service already uses this SKU."
        );
    }

    const salesPrice =
        toNonNegativeNumber(
            productData.salesPrice ??
            existingProduct?.salesPrice ??
            0,
            "Sales price"
        );

    const purchaseCost =
        toNonNegativeNumber(
            productData.purchaseCost ??
            existingProduct?.purchaseCost ??
            0,
            "Purchase cost"
        );

    const reorderLevel =
        toNonNegativeNumber(
            productData.reorderLevel ??
            existingProduct?.reorderLevel ??
            0,
            "Reorder level"
        );

    const trackInventory =
        type === "Product"
            ? Boolean(
                productData.trackInventory ??
                existingProduct?.trackInventory
            )
            : false;

    const openingStock =
        existingProduct
            ? Number(
                existingProduct.quantityOnHand
            ) || 0
            : trackInventory
                ? toNonNegativeNumber(
                    productData.openingStock ??
                    productData.quantityOnHand ??
                    0,
                    "Opening stock"
                )
                : 0;

    return {
        name,
        sku,
        type,

        description:
            String(
                productData.description ??
                existingProduct?.description ??
                ""
            ).trim(),

        salesPrice:
            roundMoney(salesPrice),

        purchaseCost:
            roundMoney(
                purchaseCost
            ),

        taxRate:
            Number(
                productData.taxRate ??
                existingProduct?.taxRate ??
                20
            ) || 0,

        trackInventory,

        quantityOnHand:
            trackInventory
                ? openingStock
                : 0,

        reorderLevel:
            trackInventory
                ? reorderLevel
                : 0,

        salesAccount:
            String(
                productData.salesAccount ??
                existingProduct?.salesAccount ??
                "Sales"
            ).trim(),

        purchaseAccount:
            String(
                productData.purchaseAccount ??
                existingProduct?.purchaseAccount ??
                "Cost of goods sold"
            ).trim(),

        status:
            productData.status ??
            existingProduct?.status ??
            "Active",
    };
};

// Gets products.
export const getProducts = ({
    search = "",
    type = "",
    status = "",
    stockStatus = "",
} = {}) => {
    let products =
        initialiseProducts().map(
            enrichProduct
        );

    const cleanedSearch =
        normaliseText(search);

    if (cleanedSearch) {
        products = products.filter(
            (product) =>
                [
                    product.name,
                    product.sku,
                    product.description,
                    product.salesAccount,
                    product.purchaseAccount,
                ].some((value) =>
                    normaliseText(
                        value
                    ).includes(
                        cleanedSearch
                    )
                )
        );
    }

    if (type) {
        products = products.filter(
            (product) =>
                product.type === type
        );
    }

    if (status) {
        products = products.filter(
            (product) =>
                product.status === status
        );
    }

    if (stockStatus) {
        products = products.filter(
            (product) =>
                product.stockStatus ===
                stockStatus
        );
    }

    return [...products].sort(
        (firstProduct, secondProduct) =>
            firstProduct.name.localeCompare(
                secondProduct.name
            )
    );
};

// Gets product by id.
export const getProductById = (
    productId
) => {
    const product =
        initialiseProducts().find(
            (currentProduct) =>
                String(
                    currentProduct.id
                ) === String(productId)
        );

    return product
        ? enrichProduct(product)
        : null;
};

// Gets product summary.
export const getProductSummary =
    () => {
        const products =
            initialiseProducts()
                .filter(
                    (product) =>
                        product.status ===
                        "Active"
                )
                .map(enrichProduct);

        return products.reduce(
            (summary, product) => {
                const isTrackedProduct =
                    product.type ===
                    "Product" &&
                    product.trackInventory;

                return {
                    totalItems:
                        summary.totalItems + 1,

                    products:
                        summary.products +
                        (product.type ===
                            "Product"
                            ? 1
                            : 0),

                    services:
                        summary.services +
                        (product.type ===
                            "Service"
                            ? 1
                            : 0),

                    lowStock:
                        summary.lowStock +
                        ([
                            "Low stock",
                            "Out of stock",
                        ].includes(
                            product.stockStatus
                        )
                            ? 1
                            : 0),

                    inventoryValue:
                        roundMoney(
                            summary.inventoryValue +
                            (isTrackedProduct
                                ? product.inventoryValue
                                : 0)
                        ),
                };
            },
            {
                totalItems: 0,
                products: 0,
                services: 0,
                lowStock: 0,
                inventoryValue: 0,
            }
        );
    };

// Creates product.
export const createProduct = (
    productData
) => {
    const products =
        initialiseProducts();

    const now =
        new Date().toISOString();

    const preparedProduct =
        validateProduct(
            productData
        );

    const product = {
        id: createId(),

        ...preparedProduct,

        createdAt: now,
        updatedAt: now,
    };

    saveProductsToStorage([
        ...products,
        product,
    ]);

    return enrichProduct(product);
};

// Updates product.
export const updateProduct = (
    productId,
    productData
) => {
    const products =
        initialiseProducts();

    const existingProduct =
        products.find(
            (product) =>
                String(product.id) ===
                String(productId)
        );

    if (!existingProduct) {
        throw new Error(
            "Product or service not found."
        );
    }

    const preparedProduct =
        validateProduct(
            productData,
            existingProduct
        );

    const updatedProduct = {
        ...existingProduct,
        ...preparedProduct,

        id:
            existingProduct.id,

        quantityOnHand:
            existingProduct.type ===
                "Product" &&
                existingProduct.trackInventory
                ? Number(
                    existingProduct.quantityOnHand
                ) || 0
                : preparedProduct.trackInventory
                    ? 0
                    : 0,

        updatedAt:
            new Date().toISOString(),
    };

    const updatedProducts =
        products.map(
            (product) =>
                String(product.id) ===
                    String(productId)
                    ? updatedProduct
                    : product
        );

    saveProductsToStorage(
        updatedProducts
    );

    return enrichProduct(
        updatedProduct
    );
};

// Performs the archive product task.
export const archiveProduct = (
    productId
) => {
    return updateProductStatus(
        productId,
        "Archived"
    );
};

// Performs the restore product task.
export const restoreProduct = (
    productId
) => {
    return updateProductStatus(
        productId,
        "Active"
    );
};

// Updates product status.
const updateProductStatus = (
    productId,
    status
) => {
    const products =
        initialiseProducts();

    const existingProduct =
        products.find(
            (product) =>
                String(product.id) ===
                String(productId)
        );

    if (!existingProduct) {
        throw new Error(
            "Product or service not found."
        );
    }

    const updatedProduct = {
        ...existingProduct,
        status,
        updatedAt:
            new Date().toISOString(),
    };

    const updatedProducts =
        products.map(
            (product) =>
                String(product.id) ===
                    String(productId)
                    ? updatedProduct
                    : product
        );

    saveProductsToStorage(
        updatedProducts
    );

    return enrichProduct(
        updatedProduct
    );
};

// Deletes product.
export const deleteProduct = (
    productId
) => {
    const products =
        initialiseProducts();

    const product =
        products.find(
            (currentProduct) =>
                String(
                    currentProduct.id
                ) === String(productId)
        );

    if (!product) {
        throw new Error(
            "Product or service not found."
        );
    }

    if (
        product.trackInventory &&
        Math.abs(
            Number(
                product.quantityOnHand
            ) || 0
        ) > 0.005
    ) {
        throw new Error(
            "This product still has stock on hand. Adjust the stock to zero or archive the product instead."
        );
    }

    const updatedProducts =
        products.filter(
            (currentProduct) =>
                String(
                    currentProduct.id
                ) !== String(productId)
        );

    saveProductsToStorage(
        updatedProducts
    );

    return enrichProduct(product);
};

// Resets products.
export const resetProducts = () => {
    const initialProducts =
        cloneData(defaultProducts);

    saveProductsToStorage(
        initialProducts
    );

    return initialProducts;
};




// Performs the round stock quantity task.
const roundStockQuantity = (
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

// Sets product stock quantity.
export const setProductStockQuantity = (
    productId,
    quantity,
    {
        allowArchived = false,
    } = {}
) => {
    const products =
        initialiseProducts();

    const existingProduct =
        products.find(
            (product) =>
                String(product.id) ===
                String(productId)
        );

    if (!existingProduct) {
        throw new Error(
            "Product not found."
        );
    }

    if (
        existingProduct.type !==
        "Product" ||
        !existingProduct.trackInventory
    ) {
        throw new Error(
            "Stock cannot be adjusted because inventory tracking is not enabled for this item."
        );
    }

    if (
        existingProduct.status ===
        "Archived" &&
        !allowArchived
    ) {
        throw new Error(
            "Archived products cannot receive stock adjustments. Restore the product first."
        );
    }

    const parsedQuantity =
        Number(quantity);

    if (
        !Number.isFinite(
            parsedQuantity
        )
    ) {
        throw new Error(
            "Enter a valid stock quantity."
        );
    }

    if (
        parsedQuantity < -0.0005
    ) {
        throw new Error(
            "Stock quantity cannot be below zero."
        );
    }

    const updatedProduct = {
        ...existingProduct,

        quantityOnHand:
            roundStockQuantity(
                Math.max(
                    parsedQuantity,
                    0
                )
            ),

        updatedAt:
            new Date().toISOString(),
    };

    const updatedProducts =
        products.map(
            (product) =>
                String(product.id) ===
                    String(productId)
                    ? updatedProduct
                    : product
        );

    saveProductsToStorage(
        updatedProducts
    );

    return enrichProduct(
        updatedProduct
    );
};

// Performs the adjust product stock task.
export const adjustProductStock = (
    productId,
    quantityChange
) => {
    const product =
        getProductById(productId);

    if (!product) {
        throw new Error(
            "Product not found."
        );
    }

    const parsedChange =
        Number(quantityChange);

    if (
        !Number.isFinite(
            parsedChange
        )
    ) {
        throw new Error(
            "Enter a valid adjustment quantity."
        );
    }

    const currentQuantity =
        Number(
            product.quantityOnHand
        ) || 0;

    const nextQuantity =
        roundStockQuantity(
            currentQuantity +
            parsedChange
        );

    return setProductStockQuantity(
        productId,
        nextQuantity
    );
};