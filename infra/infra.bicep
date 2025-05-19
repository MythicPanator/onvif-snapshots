// infra.bicep – Minimal, cost-effective Azure infrastructure for camera snapshot scheduling 
// Deploys:
// 1. Storage Account (with Static Website enabled) for storing & serving snapshots
// 2. Function App (Python, Consumption plan) with environment-based configuration
// 3. Application Insights for monitoring and diagnostics
//
// Usage:
//   az deployment group create -g <resource-group> -f infra.bicep \
//       -p projectPrefix='snapshot' \
//       -p logAnalyticsWorkspaceId='<resourceID>'

param projectPrefix string = 'snapshot'   // short lowercase prefix for resource names
param location       string = resourceGroup().location
param storageSku     string = 'Standard_LRS'
param runtimeVersion string = '~4'
param pythonVersion  string = '3.11'
param timerCron      string = '0 */30 * * * *'
param retentionCron  string = '0 0 * * * *'
@description('Resource ID of an existing Log Analytics workspace')
param logAnalyticsWorkspaceId string

// ────────────────────────────────────────────────
// Storage Account
// ────────────────────────────────────────────────
resource stg 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: '${projectPrefix}${uniqueString(resourceGroup().id)}'
  location: location
  sku: {
    name: storageSku
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

// Blob service ("default") with Static Website feature switched on
resource web 'Microsoft.Storage/storageAccounts/blobServices@2021-09-01' = {
  parent: stg
  name: 'default'
  properties: {
    staticWebsite: {
      enabled: true
      indexDocument: 'index.html'
      error404Document: '404.html'
    }
  }
}

// Container to hold all snapshots
resource snaps 'Microsoft.Storage/storageAccounts/blobServices/containers@2021-09-01' = {
  parent: web
  name: 'snapshots'
}

// ────────────────────────────────────────────────
// Application Insights
// ────────────────────────────────────────────────
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${projectPrefix}-ai'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspaceId
  }
}

// ────────────────────────────────────────────────
// Function App (Consumption Plan)
// ────────────────────────────────────────────────
resource plan 'Microsoft.Web/serverfarms@2021-02-01' = {
  name: '${projectPrefix}-plan'
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true // Linux plan
  }
}

resource func 'Microsoft.Web/sites@2022-09-01' = {
  name: '${projectPrefix}-func'
  location: location
  kind: 'functionapp,linux'  // ← explicitly Linux
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'PYTHON|${pythonVersion}'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: stg.listKeys().keys[0].value
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: runtimeVersion
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        // ─── Camera / snapshot config ────────────────────────────
        {
          name: 'CAMERA_IP'
          value: ''
        }
        {
          name: 'CAMERA_USER'
          value: ''
        }
        {
          name: 'CAMERA_PASSWORD'
          value: ''
        }
        {
          name: 'CAMERA_PRESETS'
          value: '1,2,3,4'
        }
        {
          name: 'PRESET_WAIT'
          value: '14'
        }
        {
          name: 'MAX_RETRIES'
          value: '3'
        }
        {
          name: 'RETRY_DELAY'
          value: '2'
        }
        {
          name: 'SNAPSHOT_CONTAINER'
          value: 'snapshots'
        }
        {
          name: 'TIMER_SCHEDULE'
          value: timerCron
        }
        // ─── Retention config ────────────────────────────────────
        {
          name: 'RETENTION_SCHEDULE'
          value: retentionCron
        }
        {
          name: 'RETENTION_DAYS'
          value: '180'
        }
        {
          name: 'KEEP_PER_DAY'
          value: '5'
        }
        // ─── Monitoring ──────────────────────────────────────────
        {
          name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
          value: appInsights.properties.InstrumentationKey
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
      ]
    }
  }
  dependsOn: [plan, stg, appInsights]
}

// ────────────────────────────────────────────────
// Outputs
// ────────────────────────────────────────────────
output storageUrl       string = 'https://${stg.name}.blob.core.windows.net/snapshots/'
output staticSiteUrl    string = 'https://${stg.name}.z6.web.core.windows.net/' // edge stamp will vary
output functionName     string = func.name
