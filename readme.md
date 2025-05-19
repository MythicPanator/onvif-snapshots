# Camera Snapshot Hosting on Azure

This project captures periodic snapshots from an **ONVIF‑compatible camera** and publishes them through an Azure‑hosted static website.  
It is optimised for **near‑zero monthly cost** using:

* **Azure Functions (Consumption)** — timer‑triggered sampler  
* **Azure Blob Storage** — stores original timeline plus a fixed **`latest/`** alias  
* **Static Website** (or public container) — exposes images via stable URLs

---

## Architecture

```
┌──────────────────────────────┐
│ Timer‑triggered Azure Function│  (every 30 min)
│  • onvif_client.snapshot_with_retry │
└──────────────┬───────────────┘
               │  .jpg files
               ▼
Snapshots ➜  snapshots/YYYY/MM/DD/snapshot_#.jpg
               │
               ├─► copy ➜ snapshots/latest/snapshot_#.jpg
               │        (stable URL per angle)
               ▼
Azure Blob Storage  (Hot→Cool→Archive lifecycle)
               │
Static Website  or   CDN
               ▼
<img src="https://{storage}.blob.core.windows.net/snapshots/latest/snapshot_1.jpg">
```

---

## Infrastructure (`infra.bicep`)

| Resource | Notes |
|----------|-------|
| **Storage Account** (`staticWebsite.enabled = true`) | container `snapshots`, public read |
| **Azure Function App** (Python 3.11, Y1 plan) | timer cron `0 */30 * * * *` |
| **Application Insights** | free diagnostics |

Deploy:

```bash
az deployment group create -g <ResourceGroup> -f infra.bicep -p projectPrefix=snapshot
```

Outputs include `storageUrl` for quick access.

---


## Retention & Cost Plan

* **Raw density (first 180 days)** – 192 imgs/day → 61 GB  
* **Thinned tail** – 20 imgs/day → grows 0.036 GB/day ≈ 59 GB after 5 years  
* **Hot 30 d → Cool 60 d → Archive** thereafter  

Projected 5‑year storage cost:

| Tier        | Capacity | Price/GB | Cost |
|-------------|----------|----------|------|
| Hot (avg)   | ≈61 GB   | \$0.0184 | \$1.1/mo |
| Cool        | ≈12 GB   | \$0.01   | \$0.12/mo |
| Archive     | ≈47 GB   | \$0.001  | \$0.05/mo |

**Total:** ~ **\$1.3/month** by year 5, \~\$70 over 5 years, still within hobby budget.

---

## License

Dual‑licensed:

- [The Unlicense](LICENSE) — public‑domain dedication  
- MIT — fallback where public domain isn’t recognised

You may use this project under **either license**, at your option.

---

## Disclaimer

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

## ONVIF Standard Notice

This project utilizes the **ONVIF** standard for camera communication.  
ONVIF® is a trademark of the ONVIF organisation.  
This project is **not affiliated with or endorsed by ONVIF**.  
For official information, visit <https://www.onvif.org/>.
