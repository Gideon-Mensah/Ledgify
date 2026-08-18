// Call payroll calculation and posting workflows while keeping pay rules on the backend.

import { api } from "./api";
export const payrollApiService={
  employees:()=>api.get("employees/"),createEmployee:(data)=>api.post("employees/",data),assignComponent:(id,data)=>api.post(`employees/${id}/components/`,data),
  components:()=>api.get("payroll-components/"),createComponent:(data)=>api.post("payroll-components/",data),updateComponent:(id,data)=>api.patch(`payroll-components/${id}/`,data),
  runs:()=>api.get("payroll-runs/"),run:(id)=>api.get(`payroll-runs/${id}/`),createRun:(data)=>api.post("payroll-runs/",data),calculate:(id)=>api.post(`payroll-runs/${id}/calculate/`,{}),approve:(id)=>api.post(`payroll-runs/${id}/approve/`,{}),post:(id)=>api.post(`payroll-runs/${id}/post/`,{}),pay:(id,data)=>api.post(`payroll-runs/${id}/pay/`,data),
  payslips:()=>api.get("payslips/"),summary:()=>api.get("payroll-reports/summary/"),earnings:()=>api.get("payroll-reports/earnings/"),liability:()=>api.get("payroll-reports/liability/"),yearToDate:(year)=>api.get(`payroll-reports/year-to-date/?year=${year}`),
};
