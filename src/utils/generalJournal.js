const amount = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const isLedgerEffectiveJournal = (journal) => ["posted", "reversed"].includes(journal.status);

export function orderedJournalLines(lines = []) {
  return lines.map((line, index) => ({ ...line, _index: index }))
    .sort((left, right) => {
      const leftCredit = amount(left.credit) > 0 ? 1 : 0;
      const rightCredit = amount(right.credit) > 0 ? 1 : 0;
      return leftCredit - rightCredit || left._index - right._index;
    });
}

export function journalTotals(journals = []) {
  return journals.reduce((totals, journal) => {
    for (const line of journal.lines || []) {
      totals.debit += amount(line.debit);
      totals.credit += amount(line.credit);
      if (amount(line.debit) > 0 && amount(line.credit) > 0) totals.malformed += 1;
    }
    return totals;
  }, { debit: 0, credit: 0, malformed: 0 });
}

export function generalJournalExportRows(journals = []) {
  return journals.flatMap((journal) => {
    const reversal = journal.reversal_of || journal.reversal_entry;
    return orderedJournalLines(journal.lines).map((line, index) => ({
      row_type: "account",
      date: index === 0 ? journal.date : "",
      journal_number: journal.entry_number,
      particulars: `${amount(line.credit) > 0 ? "   " : ""}${line.account?.name || "Unknown account"}`,
      post_ref: line.account?.code || "",
      debit: amount(line.debit),
      credit: amount(line.credit),
      status: journal.status,
      source: journal.source_type,
      reversal_reference: reversal?.entry_number || "",
      narration: journal.description || "",
    })).concat({
      row_type: "narration", date: "", journal_number: journal.entry_number,
      particulars: journal.description || "No narration", post_ref: "", debit: "", credit: "",
      status: journal.status, source: journal.source_type,
      reversal_reference: reversal?.entry_number || "", narration: journal.description || "",
    });
  });
}
