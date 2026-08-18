import {
    Check,
    ChevronDown,
    Plus,
    Search,
    UserRound,
} from "lucide-react";
import {
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

// Renders the contact autocomplete component.
function ContactAutocomplete({
    value = "",
    contacts = [],
    onChange,
    placeholder = "Search contacts",
    disabled = false,
    allowCreate = true,
    className = "",
}) {
    const containerRef =
        useRef(null);

    const inputRef =
        useRef(null);

    const [isOpen, setIsOpen] =
        useState(false);

    const [
        highlightedIndex,
        setHighlightedIndex,
    ] = useState(-1);

    const normalisedContacts =
        // Recalculates this value only when its inputs change.
        useMemo(() => {
            const contactMap =
                new Map();

            contacts.forEach(
                (contact) => {
                    const name =
                        typeof contact ===
                        "string"
                            ? contact.trim()
                            : (
                                contact.name ||
                                contact.contactName ||
                                contact.displayName ||
                                ""
                            ).trim();

                    if (!name) {
                        return;
                    }

                    const normalisedName =
                        name.toLowerCase();

                    if (
                        contactMap.has(
                            normalisedName
                        )
                    ) {
                        return;
                    }

                    contactMap.set(
                        normalisedName,
                        {
                            id:
                                typeof contact ===
                                "string"
                                    ? normalisedName
                                    : contact.id ||
                                      normalisedName,

                            name,

                            type:
                                typeof contact ===
                                "string"
                                    ? "Contact"
                                    : contact.type ||
                                      contact.contactType ||
                                      "Contact",

                            email:
                                typeof contact ===
                                "string"
                                    ? ""
                                    : contact.email ||
                                      "",
                        }
                    );
                }
            );

            return [
                ...contactMap.values(),
            ].sort((first, second) =>
                first.name.localeCompare(
                    second.name
                )
            );
        }, [contacts]);

    const filteredContacts =
        // Recalculates this value only when its inputs change.
        useMemo(() => {
            const searchValue =
                value
                    .trim()
                    .toLowerCase();

            if (!searchValue) {
                return normalisedContacts.slice(
                    0,
                    8
                );
            }

            return normalisedContacts
                .filter((contact) => {
                    const searchableValue =
                        [
                            contact.name,
                            contact.email,
                            contact.type,
                        ]
                            .join(" ")
                            .toLowerCase();

                    return searchableValue.includes(
                        searchValue
                    );
                })
                .slice(0, 8);
        }, [
            normalisedContacts,
            value,
        ]);

    const exactContactExists =
        normalisedContacts.some(
            (contact) =>
                contact.name
                    .trim()
                    .toLowerCase() ===
                value
                    .trim()
                    .toLowerCase()
        );

    const canCreateContact =
        allowCreate &&
        value.trim() &&
        !exactContactExists;

    const suggestionCount =
        filteredContacts.length +
        (canCreateContact ? 1 : 0);

    // Keeps this part of the page in sync when its inputs change.
    useEffect(() => {
        // Handles outside click.
        const handleOutsideClick = (
            event
        ) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(
                    event.target
                )
            ) {
                setIsOpen(false);
                setHighlightedIndex(-1);
            }
        };

        document.addEventListener(
            "mousedown",
            handleOutsideClick
        );

        return () => {
            document.removeEventListener(
                "mousedown",
                handleOutsideClick
            );
        };
    }, []);

    // Keeps this part of the page in sync when its inputs change.
    useEffect(() => {
        if (!isOpen) {
            const resetHighlight = window.requestAnimationFrame(
                () => setHighlightedIndex(-1)
            );
            return () => window.cancelAnimationFrame(resetHighlight);
        }
    }, [isOpen]);

    // Performs the select contact task.
    const selectContact = (
        contact
    ) => {
        onChange?.(
            contact.name,
            contact
        );

        setIsOpen(false);
        setHighlightedIndex(-1);

        requestAnimationFrame(() => {
            inputRef.current?.focus();
        });
    };

    // Creates contact.
    const createContact = () => {
        const contactName =
            value.trim();

        if (!contactName) {
            return;
        }

        const newContact = {
            id: `new-${Date.now()}`,
            name: contactName,
            type: "New contact",
            isNew: true,
        };

        onChange?.(
            contactName,
            newContact
        );

        setIsOpen(false);
        setHighlightedIndex(-1);
    };

    // Performs the select highlighted item task.
    const selectHighlightedItem =
        () => {
            if (
                highlightedIndex < 0
            ) {
                return;
            }

            if (
                highlightedIndex <
                filteredContacts.length
            ) {
                selectContact(
                    filteredContacts[
                        highlightedIndex
                    ]
                );

                return;
            }

            if (canCreateContact) {
                createContact();
            }
        };

    // Handles key down.
    const handleKeyDown = (
        event
    ) => {
        if (
            event.key ===
            "ArrowDown"
        ) {
            event.preventDefault();

            if (!isOpen) {
                setIsOpen(true);
            }

            setHighlightedIndex(
                (currentIndex) =>
                    currentIndex >=
                    suggestionCount - 1
                        ? 0
                        : currentIndex + 1
            );

            return;
        }

        if (
            event.key ===
            "ArrowUp"
        ) {
            event.preventDefault();

            if (!isOpen) {
                setIsOpen(true);
            }

            setHighlightedIndex(
                (currentIndex) =>
                    currentIndex <= 0
                        ? suggestionCount - 1
                        : currentIndex - 1
            );

            return;
        }

        if (event.key === "Enter") {
            if (
                isOpen &&
                highlightedIndex >= 0
            ) {
                event.preventDefault();
                selectHighlightedItem();
            }

            return;
        }

        if (event.key === "Escape") {
            setIsOpen(false);
            setHighlightedIndex(-1);

            return;
        }

        if (event.key === "Tab") {
            setIsOpen(false);
            setHighlightedIndex(-1);
        }
    };

    return (
        <div
            ref={containerRef}
            className={[
                "contact-autocomplete",
                isOpen
                    ? "contact-autocomplete-open"
                    : "",
                disabled
                    ? "contact-autocomplete-disabled"
                    : "",
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            <div className="contact-autocomplete-input-wrapper">
                <Search
                    size={15}
                    className="contact-autocomplete-search-icon"
                />

                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    disabled={disabled}
                    placeholder={
                        placeholder
                    }
                    autoComplete="off"
                    onFocus={() => {
                        if (!disabled) {
                            setIsOpen(true);
                        }
                    }}
                    onClick={() => {
                        if (!disabled) {
                            setIsOpen(true);
                        }
                    }}
                    onChange={(event) => {
                        onChange?.(
                            event.target.value,
                            null
                        );

                        setIsOpen(true);
                        setHighlightedIndex(
                            -1
                        );
                    }}
                    onKeyDown={
                        handleKeyDown
                    }
                />

                <button
                    type="button"
                    className="contact-autocomplete-toggle"
                    disabled={disabled}
                    aria-label={
                        isOpen
                            ? "Close contact suggestions"
                            : "Open contact suggestions"
                    }
                    onClick={() => {
                        setIsOpen(
                            (currentValue) =>
                                !currentValue
                        );

                        inputRef.current?.focus();
                    }}
                >
                    <ChevronDown
                        size={15}
                    />
                </button>
            </div>

            {isOpen && !disabled && (
                <div className="contact-autocomplete-menu">
                    {filteredContacts.length >
                    0 ? (
                        <div className="contact-autocomplete-options">
                            {filteredContacts.map(
                                (
                                    contact,
                                    index
                                ) => {
                                    const isSelected =
                                        contact.name
                                            .trim()
                                            .toLowerCase() ===
                                        value
                                            .trim()
                                            .toLowerCase();

                                    return (
                                        <button
                                            key={
                                                contact.id
                                            }
                                            type="button"
                                            className={[
                                                "contact-autocomplete-option",
                                                highlightedIndex ===
                                                index
                                                    ? "highlighted"
                                                    : "",
                                            ]
                                                .filter(
                                                    Boolean
                                                )
                                                .join(
                                                    " "
                                                )}
                                            onMouseEnter={() =>
                                                setHighlightedIndex(
                                                    index
                                                )
                                            }
                                            onMouseDown={(
                                                event
                                            ) =>
                                                event.preventDefault()
                                            }
                                            onClick={() =>
                                                selectContact(
                                                    contact
                                                )
                                            }
                                        >
                                            <span className="contact-autocomplete-avatar">
                                                <UserRound
                                                    size={
                                                        15
                                                    }
                                                />
                                            </span>

                                            <span className="contact-autocomplete-option-content">
                                                <strong>
                                                    {
                                                        contact.name
                                                    }
                                                </strong>

                                                <small>
                                                    {
                                                        contact.type
                                                    }

                                                    {contact.email
                                                        ? ` · ${contact.email}`
                                                        : ""}
                                                </small>
                                            </span>

                                            {isSelected && (
                                                <Check
                                                    size={
                                                        16
                                                    }
                                                />
                                            )}
                                        </button>
                                    );
                                }
                            )}
                        </div>
                    ) : (
                        <div className="contact-autocomplete-empty">
                            No existing contacts
                            found.
                        </div>
                    )}

                    {canCreateContact && (
                        <button
                            type="button"
                            className={[
                                "contact-autocomplete-create",
                                highlightedIndex ===
                                filteredContacts.length
                                    ? "highlighted"
                                    : "",
                            ]
                                .filter(Boolean)
                                .join(" ")}
                            onMouseEnter={() =>
                                setHighlightedIndex(
                                    filteredContacts.length
                                )
                            }
                            onMouseDown={(
                                event
                            ) =>
                                event.preventDefault()
                            }
                            onClick={
                                createContact
                            }
                        >
                            <Plus size={16} />

                            <span>
                                Create{" "}
                                <strong>
                                    “
                                    {value.trim()}
                                    ”
                                </strong>
                            </span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
    
}

export default ContactAutocomplete;
