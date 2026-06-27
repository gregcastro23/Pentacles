/* Library entry for `npm run build:chart` — bundles the CSS with the module so
   other alchm projects can import a single artifact:
     import AlchmChart from 'alchm-chart'        // or the UMD global window.AlchmChart
   Host apps still inject their own providers (chart engine, AMM, sky catalog). */
import "./alchm-chart.css";
export { default, create, compute, version } from "./index.js";
