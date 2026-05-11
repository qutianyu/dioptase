import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  Paintbrush,
  Copy,
  Check,
  FileCode,
  Sparkles,
  Minimize2,
  Maximize2,
  Eraser,
  ChevronDown,
  Zap,
  Type,
  Hash,
  Link,
  Unlink,
} from "lucide-react";
import hljs from "highlight.js";
import { format as sqlFormat } from "sql-formatter";

const LANGUAGES = [
  { value: "json", label: "JSON" },
  { value: "xml", label: "XML" },
  { value: "sql", label: "SQL" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "java", label: "Java" },
  { value: "go", label: "Go" },
  { value: "python", label: "Python" },
  { value: "css", label: "CSS" },
  { value: "html", label: "HTML" },
  { value: "bash", label: "Shell" },
];

const EXAMPLES: Record<string, string> = {
  json: `{"product":{"id":1001,"name":"MacBook Pro","price":19999.99,"in_stock":true,"tags":["laptop","apple","m3"],"specs":{"cpu":"M3 Pro","ram":36,"storage":512,"cores":{"performance":6,"efficiency":6}},"description":"Apple's most advanced laptop\\nwith \\"stunning\\" display.","metadata":null,"rating":4.8,"discount":-0.15,"unicode":"中文测试","empty_list":[],"empty_obj":{},"nested":[[1,2,3],[4,5,6],[7,8,9]]}}`,

  xml: `<?xml version="1.0" encoding="UTF-8"?>
<!-- Product catalog with various data types -->
<catalog xmlns:dc="http://purl.org/dc/elements/1.1/">
  <product id="p1001" category="electronics" inStock="true">
    <name>MacBook Pro</name>
    <price currency="CNY">19999.99</price>
    <quantity>42</quantity>
    <rating>4.8</rating>
    <description><![CDATA[Apple's "flagship" laptop &amp; most powerful <portable> workstation]]></description>
    <specs>
      <cpu cores="12">M3 Pro</cpu>
      <ram unit="GB">36</ram>
      <storage unit="GB">512</storage>
    </specs>
    <tags>
      <tag>laptop</tag>
      <tag>apple</tag>
      <tag>m3</tag>
    </tags>
    <features />
    <dc:creator>Apple Inc.</dc:creator>
  </product>
  <product id="p1002" category="accessories" inStock="false">
    <name>Magic Mouse</name>
    <price currency="CNY">699.00</price>
    <quantity>0</quantity>
    <rating>4.5</rating>
    <description>Wireless multi-touch surface</description>
    <features />
  </product>
</catalog>`,

  sql: `SELECT
  p.product_id,
  p.name AS product_name,
  p.price,
  p.rating,
  c.category_name,
  COUNT(DISTINCT o.order_id) AS total_orders,
  SUM(oi.quantity) AS total_sold,
  ROUND(AVG(r.score), 2) AS avg_rating,
  CASE
    WHEN p.price < 1000 THEN 'budget'
    WHEN p.price BETWEEN 1000 AND 5000 THEN 'mid-range'
    WHEN p.price > 5000 THEN 'premium'
    ELSE 'unknown'
  END AS price_tier
FROM products p
LEFT JOIN categories c ON p.category_id = c.category_id
LEFT JOIN order_items oi ON p.product_id = oi.product_id
LEFT JOIN orders o ON oi.order_id = o.order_id AND o.status IN ('completed', 'shipped')
LEFT JOIN reviews r ON p.product_id = r.product_id
WHERE p.is_active = TRUE
  AND p.created_at >= '2024-01-01'
  AND p.name LIKE '%Pro%'
GROUP BY p.product_id, p.name, p.price, p.rating, c.category_name
HAVING COUNT(DISTINCT o.order_id) > 0
ORDER BY total_sold DESC, avg_rating DESC
LIMIT 20 OFFSET 0;`,

  javascript: `// Product data with various types and escape sequences
const products = [
  {
    id: 1001,
    name: 'MacBook Pro',
    price: 19999.99,
    discount: -0.15,
    inStock: true,
    tags: ['laptop', 'apple', 'm3'],
    specs: { cpu: 'M3 Pro', ram: 36, storage: 512 },
    description: 'Apple\\'s "flagship" laptop with multi-line\nperformance.',
    rating: 4.8,
    metadata: null,
    regex: /^[A-Z][a-z]+\\sPro$/,
    unicode: '\\u4e2d\\u6587\\u6d4b\\u8bd5',
    emptyList: [],
    emptyObj: {},
    matrix: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
  },
];

function formatPrice(price, discount = 0) {
  const final = price * (1 + discount);
  return \`¥\${final.toFixed(2)}\`;
}

const [first, ...rest] = products;
const { name, price, tags = [] } = first || {};

const formatted = products
  .filter(p => p.price > 0 && p.inStock)
  .map(p => ({
    ...p,
    displayPrice: formatPrice(p.price, p.discount),
  }))
  .sort((a, b) => b.rating - a.rating);

console.log('Loaded:', formatted.length, 'products');`,

  typescript: `// Type definitions with generics, unions, and various types
interface Product<T = string> {
  id: number;
  name: string;
  price: number;
  discount: number;
  inStock: boolean;
  tags: string[];
  specs: Record<string, T>;
  description: string;
  rating: number | null;
  metadata?: unknown;
  regex?: RegExp;
  unicode: string;
  variants: T[];
  matrix: number[][];
}

type PriceTier = 'budget' | 'mid-range' | 'premium';
type Status = 0 | 1 | 2;

interface ApiResponse<T> {
  code: Status;
  data: T;
  message: string;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
  };
}

enum OrderStatus {
  Pending = 0,
  Processing = 1,
  Shipped = 2,
  Delivered = 3,
  Cancelled = -1,
}

function formatPrice(price: number, discount: number = 0): string {
  const final: number = price * (1 + discount);
  return \`¥\${final.toFixed(2)}\`;
}

const product: Product<string> = {
  id: 1001,
  name: 'MacBook Pro',
  price: 19999.99,
  discount: -0.15,
  inStock: true,
  tags: ['laptop', 'apple', 'm3'],
  specs: { cpu: 'M3 Pro', ram: '36GB', storage: '512GB' },
  description: 'Apple\\'s "flagship" laptop with multi-line\nperformance.',
  rating: 4.8,
  metadata: null,
  unicode: '\\u4e2d\\u6587\\u6d4b\\u8bd5',
  variants: ['Silver', 'Space Gray', 'Midnight'],
  matrix: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
};

const response: ApiResponse<Product[]> = {
  code: 1,
  data: [product],
  message: 'Success',
  pagination: { page: 1, pageSize: 20, total: 100 },
};`,

  java: `import java.util.*;
import java.util.regex.*;

public class ProductCatalog {
  public static void main(String[] args) {
    List<Product> products = Arrays.asList(
      new Product(1001, "MacBook Pro", 19999.99, -0.15, true,
        Arrays.asList("laptop", "apple", "m3"),
        Map.of("cpu", "M3 Pro", "ram", "36GB", "storage", "512GB"),
        "Apple\\'s \\\"flagship\\\" laptop with multi-line\nperformance.",
        4.8, null, "中文测试",
        Arrays.asList("Silver", "Space Gray"),
        new int[][]{{1, 2, 3}, {4, 5, 6}, {7, 8, 9}}),
      new Product(1002, "Magic Mouse", 699.00, 0.0, false,
        Arrays.asList("accessory", "apple"),
        Map.of("type", "wireless", "battery", "rechargeable"),
        "Wireless multi-touch surface",
        4.5, null, "",
        Collections.emptyList(),
        new int[][]{})
    );

    for (Product p : products) {
      double finalPrice = p.price * (1 + p.discount);
      System.out.printf("%s: ¥%.2f%n", p.name, finalPrice);
    }
  }
}

class Product {
  int id;
  String name;
  double price;
  double discount;
  boolean inStock;
  List<String> tags;
  Map<String, String> specs;
  String description;
  Double rating;
  Object metadata;
  String unicode;
  List<String> variants;
  int[][] matrix;

  Product(int id, String name, double price, double discount, boolean inStock,
          List<String> tags, Map<String, String> specs, String description,
          Double rating, Object metadata, String unicode,
          List<String> variants, int[][] matrix) {
    this.id = id; this.name = name; this.price = price; this.discount = discount;
    this.inStock = inStock; this.tags = tags; this.specs = specs;
    this.description = description; this.rating = rating;
    this.metadata = metadata; this.unicode = unicode;
    this.variants = variants; this.matrix = matrix;
  }
}`,

  go: `package main

import (
  "fmt"
  "encoding/json"
  "regexp"
)

// Product represents a product with various types
type Product struct {
  ID          int               \`json:"id"\`
  Name        string            \`json:"name"\`
  Price       float64           \`json:"price"\`
  Discount    float64           \`json:"discount"\`
  InStock     bool              \`json:"in_stock"\`
  Tags        []string          \`json:"tags"\`
  Specs       map[string]string \`json:"specs"\`
  Description string            \`json:"description"\`
  Rating      *float64          \`json:"rating,omitempty"\`
  Metadata    interface{}       \`json:"metadata,omitempty"\`
  Unicode     string            \`json:"unicode"\`
  Variants    []string          \`json:"variants"\`
  Matrix      [][]int           \`json:"matrix"\`
}

func main() {
  rating := 4.8
  products := []Product{
    {
      ID: 1001, Name: "MacBook Pro", Price: 19999.99,
      Discount: -0.15, InStock: true,
      Tags: []string{"laptop", "apple", "m3"},
      Specs: map[string]string{
        "cpu": "M3 Pro", "ram": "36GB", "storage": "512GB",
      },
      Description: "Apple\\'s \\\"flagship\\\" laptop with multi-line\nperformance.",
      Rating: &rating, Unicode: "中文测试",
      Variants: []string{"Silver", "Space Gray"},
      Matrix: [][]int{{1, 2, 3}, {4, 5, 6}, {7, 8, 9}},
    },
    {
      ID: 1002, Name: "Magic Mouse", Price: 699.00,
      Discount: 0.0, InStock: false,
      Tags: []string{"accessory", "apple"},
      Specs: map[string]string{"type": "wireless"},
      Description: "Wireless multi-touch surface",
      Unicode: "", Variants: []string{},
      Matrix: [][]int{},
    },
  }

  re := regexp.MustCompile(\`^[A-Z][a-z]+\\sPro$\`)
  fmt.Printf("Regex match: %v\\n", re.MatchString("MacBook Pro"))

  for _, p := range products {
    finalPrice := p.Price * (1 + p.Discount)
    fmt.Printf("%s: ¥%.2f\\n", p.Name, finalPrice)
  }

  data, _ := json.MarshalIndent(products[0], "", "  ")
  fmt.Println(string(data))
}`,

  python: `# Product catalog with various data types
from typing import Optional, List, Dict, Any, Union
from dataclasses import dataclass, field
from decimal import Decimal

@dataclass
class Product:
    id: int
    name: str
    price: float
    discount: float = 0.0
    in_stock: bool = True
    tags: List[str] = field(default_factory=list)
    specs: Dict[str, str] = field(default_factory=dict)
    description: str = ""
    rating: Optional[float] = None
    metadata: Any = None
    unicode: str = ""
    variants: List[str] = field(default_factory=list)
    matrix: List[List[int]] = field(default_factory=list)

products = [
    Product(
        id=1001,
        name="MacBook Pro",
        price=Decimal("19999.99"),
        discount=-0.15,
        in_stock=True,
        tags=["laptop", "apple", "m3"],
        specs={"cpu": "M3 Pro", "ram": "36GB", "storage": "512GB"},
        description='Apple\\'s "flagship" laptop with multi-line\nperformance.',
        rating=4.8,
        metadata=None,
        unicode="中文测试",
        variants=["Silver", "Space Gray", "Midnight"],
        matrix=[[1, 2, 3], [4, 5, 6], [7, 8, 9]],
    ),
    Product(
        id=1002,
        name="Magic Mouse",
        price=Decimal("699.00"),
        discount=0.0,
        in_stock=False,
        tags=["accessory", "apple"],
        specs={"type": "wireless", "battery": "rechargeable"},
        description="Wireless multi-touch surface",
        rating=4.5,
        metadata={},
        unicode="",
        variants=[],
        matrix=[],
    ),
]

def format_price(price: float, discount: float = 0.0) -> str:
    """Format price with discount."""
    final = price * (1 + discount)
    return f"¥\${final:.2f}"

for p in products:
    price_str = format_price(float(p.price), p.discount)
    print(f"{p.name}: {price_str} | Rating: {p.rating}")

# List comprehension and filtering
active = [p for p in products if p.in_stock and p.price > 1000]
tags = {tag for p in products for tag in p.tags}
print(f"Active products: {len(active)}, Unique tags: {len(tags)}")`,

  css: `/* CSS with various value types and units */
:root {
  --primary: #007aff;
  --danger: #ff3b30;
  --success: #34c759;
  --spacing-unit: 8px;
  --max-content-width: 1200px;
  --border-radius: 8px;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1d1d1f;
  background: linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%);
  min-height: 100vh;
}

.container {
  max-width: var(--max-content-width);
  margin: 0 auto;
  padding: calc(var(--spacing-unit) * 3);
}

.card {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: var(--border-radius);
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  transition: transform 0.2s, box-shadow 0.2s;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  border-radius: var(--border-radius);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--primary);
  color: white;
}

.btn-primary:hover {
  background: #0063d1;
}

.btn-danger {
  background: var(--danger);
  color: white;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

@media (max-width: 768px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .container {
    padding: 16px;
  }
}

[data-theme="dark"] body {
  background: #0d0d0f;
  color: #f5f5f7;
}

[data-theme="dark"] .card {
  background: rgba(28, 28, 30, 0.9);
  border-color: rgba(255, 255, 255, 0.06);
}`,

  html: `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Dioptase - Mac 工具箱">
  <title>Dioptase &amp; Tools</title>
  <link rel="stylesheet" href="./styles.css">
  <style>
    .hero { padding: 60px 20px; text-align: center; }
    .hero h1 { font-size: 2.5rem; margin-bottom: 16px; }
  </style>
</head>
<body>
  <nav class="navbar" data-role="primary">
    <div class="nav-brand">
      <img src="./logo.svg" alt="Dioptase" width="32" height="32">
      <span>Dioptase</span>
    </div>
    <ul class="nav-links">
      <li><a href="#/">首页</a></li>
      <li><a href="#/tools">工具</a></li>
      <li><a href="#/docs">文档</a></li>
    </ul>
  </nav>

  <main class="container">
    <section class="hero">
      <h1>欢迎使用 Dioptase</h1>
      <p>macOS 上的开发者工具箱 &amp; 实用程序</p>
      <p>支持 &lt;HTML&gt; 实体编码测试</p>
      <button class="btn btn-primary" onclick="alert('Hello!')" disabled>
        开始使用
      </button>
    </section>

    <hr>

    <section class="features">
      <h2>功能列表</h2>
      <div class="grid">
        <article class="card" data-feature="http">
          <h3>HTTP 客户端</h3>
          <p>发送请求并查看响应</p>
        </article>
        <article class="card" data-feature="beautifier">
          <h3>文本处理</h3>
          <p>格式化 JSON / XML / SQL</p>
        </article>
      </div>
    </section>

    <figure>
      <img src="./screenshot.png" alt="Screenshot" loading="lazy">
      <figcaption>Dioptase 界面预览</figcaption>
    </figure>
  </main>

  <footer>
    <p>&copy; 2024 Dioptase. All rights reserved.</p>
  </footer>

  <script type="module" src="./main.js"></script>
  <noscript>
    <p>请启用 JavaScript 以使用此应用。</p>
  </noscript>
</body>
</html>`,

  bash: `#!/usr/bin/env bash

# Dioptase setup script with various shell features
set -euo pipefail

readonly APP_NAME="Dioptase"
readonly VERSION="0.1.0"
readonly LANGUAGES=("json" "xml" "sql" "javascript" "typescript" "java" "go" "python" "css" "html" "bash")

echo "=== \${APP_NAME} v\${VERSION} Setup ==="
echo ""

# Function with arguments and return
format_size() {
  local size=\$1
  if (( size >= 1073741824 )); then
    printf "%.2f GB\\n" "\$(( size * 100 / 1073741824 ))e-2"
  elif (( size >= 1048576 )); then
    printf "%.2f MB\\n" "\$(( size * 100 / 1048576 ))e-2"
  else
    printf "%.2f KB\\n" "\$(( size * 100 / 1024 ))e-2"
  fi
}

# Array iteration
for lang in "\${LANGUAGES[@]}"; do
  echo "  - \$lang"
done

# Conditional with regex and file test
if [[ "\$OSTYPE" =~ ^darwin ]]; then
  echo "Detected: macOS"
  CONFIG_DIR="\$HOME/Library/Application Support/\$APP_NAME"
elif [[ "\$OSTYPE" =~ ^linux ]]; then
  echo "Detected: Linux"
  CONFIG_DIR="\$HOME/.config/\$APP_NAME"
else
  echo "Unsupported OS: \$OSTYPE" >&2
  exit 1
fi

# Create directories
mkdir -p "\$CONFIG_DIR"/{data,logs,cache}

# Find and process files
find . -name "*.json" -type f | while read -r file; do
  size=\$(stat -f%z "\$file" 2>/dev/null || stat -c%s "\$file" 2>/dev/null || echo 0)
  printf "%s\\t%s\\n" "\$(format_size "\$size")" "\$file"
done

# Here document with variable substitution
cat > "\$CONFIG_DIR/config.toml" << EOF
[app]
name = "\$APP_NAME"
version = "\$VERSION"

[features]
http_client = true
text_processor = true
ssh_shell = true
database = true
EOF

# Process substitution and pipeline
mapfile -t deps < <(grep -oE '"[^"]+": "[^"]+"' package.json | head -5)

# Case statement
case "\$1" in
  install|i)
    echo "Installing..."
    ;;
  uninstall|u)
    echo "Uninstalling..."
    ;;
  *)
    echo "Usage: \$0 {install|uninstall}"
    exit 1
    ;;
esac

echo "Setup complete. Config: \$CONFIG_DIR"`,
};

const ICON_BG = "rgba(175, 82, 222, 0.12)";
const ICON_COLOR = "#af52de";

function detectLanguage(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "json";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (trimmed.startsWith("<")) return "xml";
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH)\b/i.test(trimmed)) return "sql";
  if (/^\s*(function|const|let|var|import|export|class)\b/.test(trimmed)) return "javascript";
  if (/^\s*(interface|type|import|export|declare|namespace)\b/.test(trimmed) || /:\s*(string|number|boolean|void|any)\b/.test(trimmed)) return "typescript";
  if (/^\s*(package|import|public|private|protected|class)\b/.test(trimmed)) return "java";
  if (/^\s*(package\s+main|func\s|import\s*\()/m.test(trimmed)) return "go";
  if (/^\s*(def|import|from|class)\b/.test(trimmed)) return "python";
  if (/^\s*(@|\.|[#\w][\w-]*)\s*\{/.test(trimmed) || /^\s*\.[\w-]+\s*\{/.test(trimmed)) return "css";
  if (/^\s*<!DOCTYPE|^\s*<html/i.test(trimmed)) return "html";
  if (/^\s*#(!|bin|usr)/.test(trimmed)) return "bash";
  return "json";
}

function formatXml(xml: string): string {
  const PAD = "  ";
  let out = "";
  let depth = 0;
  const lines = xml.replace(/>\s*</g, ">\n<").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("</")) {
      depth = Math.max(0, depth - 1);
      out += PAD.repeat(depth) + line + "\n";
    } else if (line.startsWith("<") && !line.startsWith("<?") && !line.startsWith("<!") && !line.endsWith("/>") && line.indexOf("</") === -1) {
      out += PAD.repeat(depth) + line + "\n";
      depth++;
    } else {
      out += PAD.repeat(depth) + line + "\n";
    }
  }
  return out.trimEnd();
}

function minifyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
}

function minifyXml(text: string): string {
  return text.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();
}

function minifySql(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function computeStats(text: string) {
  const lines = text.split("\n");
  return {
    lines: lines.length,
    chars: text.length,
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
  };
}

type ToolMode = "format" | "md5" | "url-encode" | "url-decode";

const TOOLS: { id: ToolMode; label: string; icon: typeof Hash }[] = [
  { id: "format", label: "格式化", icon: Paintbrush },
  { id: "md5", label: "MD5", icon: Hash },
  { id: "url-encode", label: "URL 编码", icon: Link },
  { id: "url-decode", label: "URL 解码", icon: Unlink },
];

function md5(input: string): string {
  const rotL = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  const toHex = (v: number) => {
    const h = "0123456789abcdef";
    let s = "";
    for (let i = 0; i < 4; i++) s += h[(v >>> (i * 8 + 4)) & 0xf] + h[(v >>> (i * 8)) & 0xf];
    return s;
  };

  // UTF-8 encode
  const utf8: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let c = input.charCodeAt(i);
    if (c < 128) utf8.push(c);
    else if (c < 2048) utf8.push(192 | (c >> 6), 128 | (c & 63));
    else if (c < 55296 || c >= 57344) utf8.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    else {
      i++;
      c = 65536 + (((c & 1023) << 10) | (input.charCodeAt(i) & 1023));
      utf8.push(240 | (c >> 18), 128 | ((c >> 12) & 63), 128 | ((c >> 6) & 63), 128 | (c & 63));
    }
  }

  const origLen = utf8.length * 8;
  utf8.push(0x80);
  while ((utf8.length * 8) % 512 !== 448) utf8.push(0);
  for (let i = 0; i < 8; i++) utf8.push((origLen >>> (i * 8)) & 0xff);

  const K = [0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391];
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let i = 0; i < utf8.length; i += 64) {
    const M: number[] = [];
    for (let j = 0; j < 64; j += 4) M.push(utf8[i + j] | (utf8[i + j + 1] << 8) | (utf8[i + j + 2] << 16) | (utf8[i + j + 3] << 24));

    let A = a0, B = b0, C = c0, D = d0;
    for (let j = 0; j < 64; j++) {
      let F: number, g: number;
      if (j < 16) { F = (B & C) | (~B & D); g = j; }
      else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
      else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * j) % 16; }

      const temp = D; D = C; C = B;
      B = (B + rotL(A + F + K[j] + M[g], S[j])) | 0;
      A = temp;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }

  return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}

interface FormatResult {
  formatted: string;
  highlighted: string;
  errorMsg: string;
}

export default function TextProcessor() {
  const [input, setInput] = useState("");
  const [tool, setTool] = useState<ToolMode>("format");
  const [language, setLanguage] = useState("json");
  const [mode, setMode] = useState<"beautify" | "minify">("beautify");
  const [userLocked, setUserLocked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState(50);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const result = useMemo<FormatResult>(() => {
    if (!input.trim()) {
      return { formatted: "", highlighted: "", errorMsg: "" };
    }

    let formatted = "";
    let errorMsg = "";

    switch (tool) {
      case "md5": {
        formatted = md5(input);
        break;
      }
      case "url-encode": {
        formatted = encodeURIComponent(input);
        break;
      }
      case "url-decode": {
        try {
          formatted = decodeURIComponent(input);
        } catch {
          errorMsg = "URL 解码失败：输入不是有效的 URL 编码字符串";
          formatted = input;
        }
        break;
      }
      default: {
        // format mode
        switch (language) {
          case "json": {
            if (mode === "minify") {
              formatted = minifyJson(input);
            } else {
              try {
                formatted = JSON.stringify(JSON.parse(input), null, 2);
              } catch (e) {
                errorMsg = `JSON 解析失败: ${String(e).slice(0, 100)}`;
                formatted = input;
              }
            }
            break;
          }
          case "xml": {
            formatted = mode === "minify" ? minifyXml(input) : formatXml(input);
            break;
          }
          case "sql": {
            if (mode === "minify") {
              formatted = minifySql(input);
            } else {
              try {
                formatted = sqlFormat(input, { language: "sql" });
              } catch {
                errorMsg = "SQL 格式化失败";
                formatted = input;
              }
            }
            break;
          }
          default: {
            formatted = input;
            break;
          }
        }
      }
    }

    let highlighted = "";
    if (tool === "format" && !errorMsg) {
      try {
        const lang = hljs.getLanguage(language);
        if (lang) {
          highlighted = hljs.highlight(formatted, { language, ignoreIllegals: true }).value;
        } else {
          highlighted = hljs.highlightAuto(formatted).value;
        }
      } catch {
        highlighted = formatted
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      }
    } else {
      highlighted = formatted
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    return { formatted, highlighted, errorMsg };
  }, [input, language, mode, tool]);

  useEffect(() => {
    setError(result.errorMsg || null);
  }, [result.errorMsg]);

  const inputLines = useMemo(() => input.split("\n"), [input]);
  const outputLines = useMemo(() => result.formatted.split("\n"), [result.formatted]);

  const inputStats = useMemo(() => computeStats(input), [input]);
  const outputStats = useMemo(() => computeStats(result.formatted), [result.formatted]);

  const handleInputChange = (value: string) => {
    setInput(value);
    if (value.trim() && !userLocked) {
      const detected = detectLanguage(value);
      if (detected !== language) {
        setLanguage(detected);
      }
    }
  };

  const handleLanguageChange = (value: string) => {
    setLanguage(value);
    setUserLocked(true);
  };

  const handleModeChange = (nextMode: "beautify" | "minify") => {
    setMode(nextMode);
  };

  const handleCopy = async () => {
    if (!result.formatted) return;
    await navigator.clipboard.writeText(result.formatted);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    setInput("");
    setError(null);
    setTool("format");
    setMode("beautify");
    setUserLocked(false);
  };

  const handleLoadExample = () => {
    const text = EXAMPLES[language] || EXAMPLES.json;
    setInput(text);
    setError(null);
    setUserLocked(true);
  };

  const handleScroll = useCallback(() => {
    const ta = inputRef.current;
    const ln = lineNumbersRef.current;
    if (ta && ln) {
      ln.scrollTop = ta.scrollTop;
    }
  }, []);

  const handleResizerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const container = workspaceRef.current;
      if (!container) return;
      const containerWidth = container.offsetWidth;
      const startWidth = (leftWidth / 100) * containerWidth;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const newW = startWidth + delta;
        const pct = Math.max(25, Math.min(75, (newW / containerWidth) * 100));
        setLeftWidth(pct);
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
    },
    [leftWidth]
  );

  const langLabel = LANGUAGES.find((l) => l.value === language)?.label || language;

  return (
    <div className="page-content animate-fade-in">
      {/* ===== Header ===== */}
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <div className="page-icon" style={{ background: ICON_BG }}>
              <Paintbrush size={18} color={ICON_COLOR} strokeWidth={2} />
            </div>
            <h2 className="page-title">文本处理</h2>
            <p className="page-subtitle">格式化 · 编码 · 哈希</p>
          </div>
        </div>
      </div>

      {/* ===== Toolbar ===== */}
      <div className="toolbar-panel mb-2">
        {/* Tool Selector */}
        <div className="flex items-center gap-1.5 mb-3">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-200 ${
                tool === t.id ? "text-white" : ""
              }`}
              style={{
                background: tool === t.id ? "var(--bg-button)" : "transparent",
                color: tool === t.id ? "#fff" : "var(--text-secondary)",
              }}
            >
              <t.icon size={13} strokeWidth={2} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Language Selector & Mode Toggle - only for format tool */}
            {tool === "format" && (
              <>
                <div className="relative">
                  <select
                    value={language}
                    onChange={(e) => handleLanguageChange(e.target.value)}
                    className="appearance-none macos-input pr-7 text-[12px] font-medium"
                    style={{ width: 130 }}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={12}
                    className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: "var(--text-muted)" }}
                  />
                </div>

                <div className="beautifier-mode-toggle">
                  <button
                    onClick={() => handleModeChange("beautify")}
                    className={mode === "beautify" ? "active" : ""}
                    title="美化"
                  >
                    <Maximize2 size={12} />
                    <span>美化</span>
                  </button>
                  <button
                    onClick={() => handleModeChange("minify")}
                    className={mode === "minify" ? "active" : ""}
                    title="压缩"
                  >
                    <Minimize2 size={12} />
                    <span>压缩</span>
                  </button>
                </div>

                <button onClick={handleLoadExample} className="btn-secondary flex items-center gap-1.5 text-[12px] py-1.5">
                  <Sparkles size={12} />
                  示例
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={!result.formatted}
              className="btn-secondary flex items-center gap-1.5 text-[12px] py-1.5"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "已复制" : "复制"}
            </button>
            <button onClick={handleClear} disabled={!input} className="btn-secondary flex items-center gap-1.5 text-[12px] py-1.5">
              <Eraser size={12} />
              清除
            </button>
          </div>
        </div>
      </div>

      {/* ===== Workspace ===== */}
      <div className="beautifier-workspace" ref={workspaceRef}>
        {/* ---- Left Panel: Input ---- */}
        <div className="beautifier-panel" style={{ width: `${leftWidth}%` }}>
          {/* Panel Header */}
          <div className="beautifier-panel-header">
            <div className="flex items-center gap-2">
              <Type size={12} style={{ color: "var(--text-muted)" }} />
              <span className="beautifier-panel-title">输入</span>
              {input && (
                <span className="badge badge-blue">
                  <Zap size={8} />
                  {tool === "format" ? langLabel : TOOLS.find(t => t.id === tool)?.label || "输入"}
                </span>
              )}
            </div>
          </div>

          {/* Panel Body */}
          <div className="beautifier-panel-body">
            {/* Line Numbers */}
            <div ref={lineNumbersRef} className="beautifier-line-numbers">
              {inputLines.map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            {/* Textarea */}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onScroll={handleScroll}
              className="beautifier-textarea font-mono text-[13px]"
              placeholder="在此粘贴或输入文本..."
              spellCheck={false}
            />
          </div>

          {/* Panel Footer */}
          <div className="beautifier-panel-footer">
            <span>{inputStats.lines} 行</span>
            <span className="beautifier-footer-sep" />
            <span>{inputStats.chars} 字符</span>
            <span className="beautifier-footer-sep" />
            <span>{inputStats.words} 词</span>
          </div>
        </div>

        {/* ---- Resizer ---- */}
        <div className="beautifier-resizer" onMouseDown={handleResizerMouseDown}>
          <div className="beautifier-resizer-handle" />
        </div>

        {/* ---- Right Panel: Output ---- */}
        <div className="beautifier-panel" style={{ width: `${100 - leftWidth}%` }}>
          {/* Panel Header */}
          <div className="beautifier-panel-header">
            <div className="flex items-center gap-2">
              <FileCode size={12} style={{ color: "var(--text-muted)" }} />
              <span className="beautifier-panel-title">输出</span>
              {result.formatted && (
                <span className={`badge ${error ? "badge-red" : "badge-green"}`}>
                  {error ? "错误" : tool === "format" ? (mode === "beautify" ? "已格式化" : "已压缩") : TOOLS.find(t => t.id === tool)?.label || "完成"}
                </span>
              )}
            </div>
            {result.formatted && (
              <button onClick={handleCopy} className="beautifier-copy-btn" title="复制">
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            )}
          </div>

          {/* Panel Body */}
          <div className="beautifier-panel-body">
            {/* Line Numbers */}
            <div className="beautifier-line-numbers">
              {outputLines.map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            {/* Output */}
            {result.highlighted ? (
              <pre className="beautifier-output hljs text-[13px]">
                <code dangerouslySetInnerHTML={{ __html: result.highlighted }} />
              </pre>
            ) : (
              <div className="beautifier-empty">
                <FileCode size={32} style={{ color: "var(--text-muted)", opacity: 0.4 }} />
                <p style={{ color: "var(--text-muted)" }}>处理结果将显示在此处</p>
                {tool === "format" && (
                  <button onClick={handleLoadExample} className="btn-secondary flex items-center gap-1.5 text-[12px] mt-3">
                    <Sparkles size={12} />
                    加载示例
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Panel Footer */}
          <div className="beautifier-panel-footer">
            <span>{outputStats.lines} 行</span>
            <span className="beautifier-footer-sep" />
            <span>{outputStats.chars} 字符</span>
            <span className="beautifier-footer-sep" />
            <span>{outputStats.words} 词</span>
            {error && (
              <>
                <span className="beautifier-footer-sep" />
                <span style={{ color: "var(--bg-danger)" }}>{error}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}