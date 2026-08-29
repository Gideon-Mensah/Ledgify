// Call payroll calculation and posting workflows while keeping pay rules on the backend.

import { api } from "./api";
const query=(params={})=>{const value=new URLSearchParams(Object.entries(params).filter(([,item])=>item!==""&&item!==null&&item!==undefined));return value.size?`?${value}`:"";};
export const payrollApiService={
  employees:()=>api.get("employees/"),createEmployee:(data)=>api.post("employees/",data),assignComponent:(id,data)=>api.post(`employees/${id}/components/`,data),
  components:()=>api.get("payroll-components/"),createComponent:(data)=>api.post("payroll-components/",data),updateComponent:(id,data)=>api.patch(`payroll-components/${id}/`,data),
  runs:()=>api.get("payroll-runs/"),run:(id)=>api.get(`payroll-runs/${id}/`),createRun:(data)=>api.post("payroll-runs/",data),calculate:(id)=>api.post(`payroll-runs/${id}/calculate/`,{}),approve:(id)=>api.post(`payroll-runs/${id}/approve/`,{}),post:(id)=>api.post(`payroll-runs/${id}/post/`,{}),pay:(id,data)=>api.post(`payroll-runs/${id}/pay/`,data),
  payslips:()=>api.get("payslips/"),summary:(filters)=>api.get(`payroll-reports/summary/${query(filters)}`),earnings:(filters)=>api.get(`payroll-reports/earnings/${query(filters)}`),liability:(filters)=>api.get(`payroll-reports/liability/${query(filters)}`),yearToDate:(year)=>api.get(`payroll-reports/year-to-date/${query({year})}`),
};
