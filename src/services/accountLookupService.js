import { coreAccountService } from "./coreAccountService";

async function byType(type) {
  const accounts = await coreAccountService.list();
  return accounts.filter((account) => account.account_type === type && account.status === "active");
}

export const accountLookupService = {
  revenue: () => byType("revenue"),
  expense: () => byType("expense"),
  bank: async () => {
    const accounts = await coreAccountService.list();
    return accounts
      .filter((account) => account.account_class === "bank" && account.status === "active")
      .map((account, index) => ({
        ...account,
        accountName: account.name,
        bankName: "",
        status: "Active",
        isDefault: index === 0,
      }));
  },
};
