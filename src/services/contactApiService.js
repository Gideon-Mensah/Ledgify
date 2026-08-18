// Map customer and supplier forms to the shared organisation contact API.

import { contactService } from "./contactService";
import { contactPayload, mapContact } from "./domainMappings";

async function list(type) {
  const data = await contactService.list(`type=${type}`);
  return data.map(mapContact);
}

export const contactApiService = {
  customers: () => list("customer"),
  suppliers: () => list("supplier"),
  async get(id) { return mapContact(await contactService.get(id)); },
  async createCustomer(data) { return mapContact(await contactService.create(contactPayload(data, "customer"))); },
  async createSupplier(data) { return mapContact(await contactService.create(contactPayload(data, "supplier"))); },
  async updateCustomer(id, data) { return mapContact(await contactService.update(id, contactPayload(data, "customer"))); },
  async updateSupplier(id, data) { return mapContact(await contactService.update(id, contactPayload(data, "supplier"))); },
  remove: (id) => contactService.remove(id),
};
