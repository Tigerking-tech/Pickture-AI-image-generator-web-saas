/**
 * JSON-LD 注入组件（R12 / PRD §11.3）
 * 服务端渲染，直接输出 <script type="application/ld+json">，可被爬虫读取。
 */

interface JsonLdProps {
  // biome-ignore lint/suspicious/noExplicitAny: JSON-LD 结构由 schema.org 定义，形态不固定
  data: Record<string, any> | Array<Record<string, any>>;
}

export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD 必须是内联脚本，内容由本仓库静态构造，不含用户输入
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
