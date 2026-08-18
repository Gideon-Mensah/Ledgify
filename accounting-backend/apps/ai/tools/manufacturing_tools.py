from apps.manufacturing.services import manufacturing_dashboard,material_requirements_report,variance_report,wip_report
def manufacturing_context(*,organisation):return {"dashboard":manufacturing_dashboard(organisation=organisation),"wip":wip_report(organisation=organisation),"shortages":material_requirements_report(organisation=organisation),"variance":variance_report(organisation=organisation)}
