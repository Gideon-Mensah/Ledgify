export function documentIdentity(org) {
 if (!org?.name) throw new Error("Complete the organisation profile before preparing documents.");
 return {name:org.legal_name||org.name,trading_name:org.legal_name&&org.legal_name!==org.name?org.name:"",address:[org.address_line_1,org.address_line_2,org.city,org.region,org.postal_code,org.ghana_post_gps,org.country_code].filter(Boolean),phone:org.phone,email:org.email,website:org.website,registration_number:org.registration_number,tax_number:org.tax_number,logo_data:org.logo_data,payment_instructions:org.payment_instructions,base_currency:org.base_currency};
}
