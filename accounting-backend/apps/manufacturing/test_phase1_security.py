from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounting.models import Account
from apps.inventory.models import Product, Warehouse
from apps.organisations.models import Organisation, OrganisationMember
from .models import BillOfMaterials, BOMVersion, BOMComponent, ProductionOrder


class ManufacturingRelationshipTests(TestCase):
    def setUp(self):
        self.user=get_user_model().objects.create_user(username='factory-security',email='factory@example.invalid',password='x')
        self.orgs=[];self.products=[];self.versions=[];self.accounts=[];self.warehouses=[]
        for index in range(2):
            org=Organisation.objects.create(name=f'Factory {index}',base_currency='GHS',created_by=self.user)
            self.orgs.append(org)
            if index==0:OrganisationMember.objects.create(organisation=org,user=self.user,role='owner')
            account=Account.objects.create(organisation=org,code='100',name='Inventory',account_type='asset',account_class='current_asset',created_by=self.user)
            expense=Account.objects.create(organisation=org,code='500',name='Cost',account_type='expense',account_class='cost_of_sales',created_by=self.user)
            self.accounts.append(account)
            product=Product.objects.create(organisation=org,code='FG',name='Goods',product_type='goods',unit='each',currency='GHS',track_inventory=True,inventory_asset_account=account,cost_of_goods_sold_account=expense,created_by=self.user)
            self.products.append(product)
            bom=BillOfMaterials.objects.create(organisation=org,product=product,code='BOM',name='BOM',created_by=self.user)
            self.versions.append(BOMVersion.objects.create(bom=bom,version_number='1',effective_from='2026-01-01',output_quantity=1,created_by=self.user))
            self.warehouses.append(Warehouse.objects.create(organisation=org,code='MAIN',name='Main',created_by=self.user))
        self.client=APIClient();self.client.force_authenticate(self.user);self.client.credentials(HTTP_X_ORGANISATION_ID=str(self.orgs[0].pk))
        self.order=ProductionOrder.objects.create(organisation=self.orgs[0],order_number='P1',product=self.products[0],bom_version=self.versions[0],warehouse=self.warehouses[0],wip_account=self.accounts[0],planned_quantity=1,start_date='2026-01-01',due_date='2026-01-02',created_by=self.user)

    def test_foreign_draft_order_relationships_rejected_on_put_and_patch(self):
        for field,obj in [('product',self.products[1]),('bom_version',self.versions[1]),('warehouse',self.warehouses[1]),('wip_account',self.accounts[1]),('variance_account',self.accounts[1])]:
            for method in ('put','patch'):
                payload={'order_number':'P1','product':str(self.products[0].pk),'bom_version':str(self.versions[0].pk),'warehouse':str(self.warehouses[0].pk),'wip_account':str(self.accounts[0].pk),'planned_quantity':'1','start_date':'2026-01-01','due_date':'2026-01-02',field:str(obj.pk)}
                with self.subTest(field=field,method=method):
                    self.assertEqual(getattr(self.client,method)(f'/api/v1/production-orders/{self.order.pk}/',payload,format='json').status_code,400)
                    self.order.refresh_from_db();self.assertNotEqual(getattr(self.order,field+'_id'),obj.pk)

    def test_foreign_relationships_on_create(self):
        for field,obj in [('product',self.products[1]),('bom_version',self.versions[1]),('warehouse',self.warehouses[1]),('wip_account',self.accounts[1]),('variance_account',self.accounts[1])]:
            payload={'order_number':'P2','product':str(self.products[0].pk),'bom_version':str(self.versions[0].pk),'warehouse':str(self.warehouses[0].pk),'wip_account':str(self.accounts[0].pk),'planned_quantity':'1','start_date':'2026-01-01','due_date':'2026-01-02',field:str(obj.pk)}
            self.assertIn(self.client.post('/api/v1/production-orders/',payload,format='json').status_code,(400,404))
        self.assertEqual(ProductionOrder.objects.count(),1)

    def test_bom_and_component_reparenting_rejected(self):
        version=self.versions[0]
        self.assertEqual(self.client.patch(f'/api/v1/bom-versions/{version.pk}/',{'bom':str(self.versions[1].bom_id)},format='json').status_code,400)
        self.assertEqual(self.client.patch(f'/api/v1/boms/{version.bom_id}/',{'product':str(self.products[1].pk)},format='json').status_code,400)
        self.assertEqual(self.client.post('/api/v1/bom-components/',{'bom_version':str(version.pk),'component_product':str(self.products[1].pk),'quantity':'1'},format='json').status_code,400)
        self.assertFalse(BOMComponent.objects.exists())

    def test_foreign_and_malformed_cost_warehouse_do_not_fall_back(self):
        for value in ('bad',str(self.warehouses[1].pk)):
            self.assertIn(self.client.get(f'/api/v1/bom-versions/{self.versions[0].pk}/cost/?warehouse={value}').status_code,(400,404))

    def test_services_reject_legacy_foreign_relationships_before_disclosure(self):
        from common.exceptions import BusinessRuleError
        from .services import calculate_bom_cost, get_production_order_cost_summary
        with self.assertRaises(BusinessRuleError):calculate_bom_cost(organisation=self.orgs[0],bom_version=self.versions[1],warehouse=self.warehouses[0])
        ProductionOrder.objects.filter(pk=self.order.pk).update(warehouse=self.warehouses[1])
        self.order.refresh_from_db()
        with self.assertRaises(BusinessRuleError):get_production_order_cost_summary(organisation=self.orgs[0],production_order=self.order)
