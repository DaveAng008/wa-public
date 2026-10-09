/**
 * 产品品牌配置（白标）
 *
 * 部署者可以在环境变量里设置 `NEXT_PUBLIC_APP_NAME` 来替换全站显示的产品名，
 * 不需要改任何代码。未设置时使用下面的中性默认值。
 *
 * 注意：NEXT_PUBLIC_ 前缀的变量会在构建时内联到客户端代码，
 * 因此修改后需要重新构建（在 Coolify 上重新 Deploy 即可）。
 */
export const APP_NAME: string = (process.env.NEXT_PUBLIC_APP_NAME || "").trim() || "WhatsApp CRM";

/** 副标题 / 版本后缀，同样可通过环境变量覆盖 */
export const APP_NAME_SUFFIX: string =
  (process.env.NEXT_PUBLIC_APP_NAME_SUFFIX || "").trim() || "Pro";
