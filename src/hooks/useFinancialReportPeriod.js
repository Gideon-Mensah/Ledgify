// Keep report period choices and comparison dates consistent across financial statements.

import {
    useCallback,
    useMemo,
} from "react";

import {
    useSearchParams,
} from "react-router-dom";

import {
    getDefaultReportRange,
    getFinancialYearForDate,
    getFinancialYearOptions,
    getPreviousFinancialYear,
    getYearToDateRange,
} from "../services/financialYearService";

export const REPORT_PERIOD_PRESETS = {
    DEFAULT:
        "default",

    CURRENT_FINANCIAL_YEAR:
        "current-financial-year",

    PREVIOUS_FINANCIAL_YEAR:
        "previous-financial-year",

    YEAR_TO_DATE:
        "year-to-date",

    CUSTOM:
        "custom",
};

const formatLocalDate = (
    date
) => {
    const year =
        date.getFullYear();

    const month =
        String(
            date.getMonth() + 1
        ).padStart(
            2,
            "0"
        );

    const day =
        String(
            date.getDate()
        ).padStart(
            2,
            "0"
        );

    return `${year}-${month}-${day}`;
};

const getToday = () => {
    return formatLocalDate(
        new Date()
    );
};

const normaliseDate = (
    value
) => {
    const text =
        String(
            value || ""
        ).trim();

    if (
        /^\d{4}-\d{2}-\d{2}$/.test(
            text
        )
    ) {
        return text;
    }

    return "";
};

const resolveReferenceDate = (
    referenceDate
) => {
    return (
        normaliseDate(
            referenceDate
        ) ||
        getToday()
    );
};

const getPresetRange = (
    preset,
    referenceDate
) => {
    const resolvedReferenceDate =
        resolveReferenceDate(
            referenceDate
        );

    if (
        preset ===
        REPORT_PERIOD_PRESETS.CURRENT_FINANCIAL_YEAR
    ) {
        return getFinancialYearForDate(
            resolvedReferenceDate
        );
    }

    if (
        preset ===
        REPORT_PERIOD_PRESETS.PREVIOUS_FINANCIAL_YEAR
    ) {
        return getPreviousFinancialYear(
            resolvedReferenceDate
        );
    }

    if (
        preset ===
        REPORT_PERIOD_PRESETS.YEAR_TO_DATE
    ) {
        return getYearToDateRange(
            resolvedReferenceDate
        );
    }

    return getDefaultReportRange(
        resolvedReferenceDate
    );
};

const determinePreset = ({
    fromDate,
    toDate,
    referenceDate,
}) => {
    const resolvedReferenceDate =
        resolveReferenceDate(
            referenceDate
        );

    try {
        /*
        |--------------------------------------------------------------------------
        | Financial year containing the reference date
        |--------------------------------------------------------------------------
        |
        | This is deliberately NOT based on the real-world current financial
        | year.
        |
        | Example:
        |
        | referenceDate = 2024-10-15
        |
        | "Current financial year" means the financial year containing
        | 15 October 2024.
        |
        */

        const current =
            getFinancialYearForDate(
                resolvedReferenceDate
            );

        if (
            fromDate ===
                current.startDate &&
            toDate ===
                current.endDate
        ) {
            return REPORT_PERIOD_PRESETS.CURRENT_FINANCIAL_YEAR;
        }

        const previous =
            getPreviousFinancialYear(
                resolvedReferenceDate
            );

        if (
            fromDate ===
                previous.startDate &&
            toDate ===
                previous.endDate
        ) {
            return REPORT_PERIOD_PRESETS.PREVIOUS_FINANCIAL_YEAR;
        }

        const yearToDate =
            getYearToDateRange(
                resolvedReferenceDate
            );

        if (
            fromDate ===
                yearToDate.startDate &&
            toDate ===
                yearToDate.endDate
        ) {
            return REPORT_PERIOD_PRESETS.YEAR_TO_DATE;
        }
    } catch (
        error
    ) {
        console.error(
            "Unable to determine report period preset:",
            error
        );
    }

    return REPORT_PERIOD_PRESETS.CUSTOM;
};

const useFinancialReportPeriod = ({
    referenceDate = getToday(),

    fromParam = "from",

    toParam = "to",
} = {}) => {
    const [
        searchParams,
        setSearchParams,
    ] = useSearchParams();

    const resolvedReferenceDate =
        useMemo(
            () =>
                resolveReferenceDate(
                    referenceDate
                ),
            [
                referenceDate,
            ]
        );

    const defaultRange =
        useMemo(
            () => {
                try {
                    return getDefaultReportRange(
                        resolvedReferenceDate
                    );
                } catch (
                    error
                ) {
                    console.error(
                        "Unable to load the default reporting period:",
                        error
                    );

                    const fallbackDate =
                        resolvedReferenceDate ||
                        getToday();

                    return {
                        startDate:
                            `${fallbackDate.slice(
                                0,
                                4
                            )}-01-01`,

                        endDate:
                            fallbackDate,

                        label:
                            "Current period",
                    };
                }
            },
            [
                resolvedReferenceDate,
            ]
        );

    const fromDate =
        normaliseDate(
            searchParams.get(
                fromParam
            )
        ) ||
        defaultRange.startDate;

    const toDate =
        normaliseDate(
            searchParams.get(
                toParam
            )
        ) ||
        defaultRange.endDate;

    const preset =
        useMemo(
            () =>
                determinePreset({
                    fromDate,
                    toDate,

                    referenceDate:
                        resolvedReferenceDate,
                }),
            [
                fromDate,
                toDate,
                resolvedReferenceDate,
            ]
        );

    /*
    |--------------------------------------------------------------------------
    | Financial year context for the displayed report
    |--------------------------------------------------------------------------
    |
    | We use the report's To date here because:
    |
    | - a full financial-year report ends on that FY's year end;
    | - YTD belongs to the FY containing its To date;
    | - a custom report may span years, but its ending FY still provides
    |   useful report context without changing the selected dates.
    |
    */

    const financialYear =
        useMemo(
            () => {
                try {
                    return getFinancialYearForDate(
                        toDate
                    );
                } catch (
                    error
                ) {
                    console.error(
                        "Unable to resolve the financial year:",
                        error
                    );

                    return null;
                }
            },
            [
                toDate,
            ]
        );

    const financialYearOptions =
        useMemo(
            () => {
                try {
                    return getFinancialYearOptions({
                        previousYears:
                            5,

                        futureYears:
                            1,

                        referenceDate:
                            toDate ||
                            resolvedReferenceDate,
                    });
                } catch (
                    error
                ) {
                    console.error(
                        "Unable to load financial year options:",
                        error
                    );

                    return [];
                }
            },
            [
                toDate,
                resolvedReferenceDate,
            ]
        );

    const setDateRange =
        useCallback(
            ({
                startDate,
                endDate,
            }) => {
                const resolvedStart =
                    normaliseDate(
                        startDate
                    );

                const resolvedEnd =
                    normaliseDate(
                        endDate
                    );

                if (
                    !resolvedStart ||
                    !resolvedEnd
                ) {
                    return;
                }

                const nextParams =
                    new URLSearchParams(
                        searchParams
                    );

                nextParams.set(
                    fromParam,
                    resolvedStart
                );

                nextParams.set(
                    toParam,
                    resolvedEnd
                );

                setSearchParams(
                    nextParams
                );
            },
            [
                fromParam,
                searchParams,
                setSearchParams,
                toParam,
            ]
        );

    const setFromDate =
        useCallback(
            (
                value
            ) => {
                const resolvedDate =
                    normaliseDate(
                        value
                    );

                if (
                    !resolvedDate
                ) {
                    return;
                }

                const nextParams =
                    new URLSearchParams(
                        searchParams
                    );

                nextParams.set(
                    fromParam,
                    resolvedDate
                );

                nextParams.set(
                    toParam,
                    toDate
                );

                setSearchParams(
                    nextParams
                );
            },
            [
                fromParam,
                searchParams,
                setSearchParams,
                toDate,
                toParam,
            ]
        );

    const setToDate =
        useCallback(
            (
                value
            ) => {
                const resolvedDate =
                    normaliseDate(
                        value
                    );

                if (
                    !resolvedDate
                ) {
                    return;
                }

                const nextParams =
                    new URLSearchParams(
                        searchParams
                    );

                nextParams.set(
                    fromParam,
                    fromDate
                );

                nextParams.set(
                    toParam,
                    resolvedDate
                );

                setSearchParams(
                    nextParams
                );
            },
            [
                fromDate,
                fromParam,
                searchParams,
                setSearchParams,
                toParam,
            ]
        );

    const applyPreset =
        useCallback(
            (
                requestedPreset
            ) => {
                if (
                    requestedPreset ===
                    REPORT_PERIOD_PRESETS.CUSTOM
                ) {
                    /*
                    |--------------------------------------------------------------------------
                    | Custom does not change dates
                    |--------------------------------------------------------------------------
                    |
                    | The user can now edit From / To directly.
                    |
                    */

                    return;
                }

                try {
                    const range =
                        getPresetRange(
                            requestedPreset,
                            resolvedReferenceDate
                        );

                    setDateRange({
                        startDate:
                            range.startDate,

                        endDate:
                            range.endDate,
                    });
                } catch (
                    error
                ) {
                    console.error(
                        "Unable to apply report period preset:",
                        error
                    );
                }
            },
            [
                resolvedReferenceDate,
                setDateRange,
            ]
        );

    const selectFinancialYear =
        useCallback(
            (
                yearEndYear
            ) => {
                const option =
                    financialYearOptions.find(
                        (
                            currentOption
                        ) =>
                            String(
                                currentOption.value
                            ) ===
                            String(
                                yearEndYear
                            )
                    );

                if (
                    !option
                ) {
                    return;
                }

                setDateRange({
                    startDate:
                        option.startDate,

                    endDate:
                        option.endDate,
                });
            },
            [
                financialYearOptions,
                setDateRange,
            ]
        );

    const resetToDefault =
        useCallback(
            () => {
                const nextParams =
                    new URLSearchParams(
                        searchParams
                    );

                nextParams.delete(
                    fromParam
                );

                nextParams.delete(
                    toParam
                );

                /*
                |--------------------------------------------------------------------------
                | Preserve unrelated query parameters
                |--------------------------------------------------------------------------
                |
                | For example:
                |
                | ?account=100
                | ?q=bank
                |
                | Resetting the report period must not remove them.
                |
                */

                setSearchParams(
                    nextParams
                );
            },
            [
                fromParam,
                searchParams,
                setSearchParams,
                toParam,
            ]
        );

    const periodLabel =
        useMemo(
            () => {
                if (
                    financialYear &&
                    fromDate ===
                        financialYear.startDate &&
                    toDate ===
                        financialYear.endDate
                ) {
                    return `Financial year ${financialYear.label}`;
                }

                if (
                    preset ===
                        REPORT_PERIOD_PRESETS.YEAR_TO_DATE &&
                    financialYear
                ) {
                    return `${financialYear.label} year to date`;
                }

                return `${fromDate} to ${toDate}`;
            },
            [
                financialYear,
                fromDate,
                preset,
                toDate,
            ]
        );

    const isCustomPeriod =
        preset ===
        REPORT_PERIOD_PRESETS.CUSTOM;

    const isValidPeriod =
        Boolean(
            fromDate &&
            toDate &&
            fromDate <=
                toDate
        );

    return {
        fromDate,

        toDate,

        preset,

        periodLabel,

        financialYear,

        financialYearOptions,

        defaultRange,

        referenceDate:
            resolvedReferenceDate,

        isCustomPeriod,

        isValidPeriod,

        setFromDate,

        setToDate,

        setDateRange,

        applyPreset,

        selectFinancialYear,

        resetToDefault,
    };
};

export default useFinancialReportPeriod;
