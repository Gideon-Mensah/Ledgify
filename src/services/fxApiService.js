// Load dated FX rates and request controlled revaluations in the organisation base currency.

import{api}from"./api";
export const fxApiService={currencies:()=>api.get("currencies/"),rates:()=>api.get("exchange-rates/"),createRate:data=>api.post("exchange-rates/",data),revaluations:()=>api.get("fx-revaluations/"),revalue:data=>api.post("fx-revaluations/run/",data),realised:()=>api.get("fx-reports/realised/"),unrealised:()=>api.get("fx-reports/unrealised/"),exposure:()=>api.get("fx-reports/exposure/")};
