# Shopify App Template - Extension Only

This is a template for building a [Shopify app](https://shopify.dev/docs/apps/getting-started) using [Preact](https://preactjs.com/) and [Vite](https://vite.dev/). It uses Shopify's [Direct API access](https://shopify.dev/docs/api/app-home#direct-api-access) and [App Bridge](https://shopify.dev/docs/api/app-bridge) to make authenticated calls to the Shopify Admin API directly from the browser — no server required.

Rather than cloning this repo, follow the [Quick Start steps](#quick-start) below.

## Quick start

### Prerequisites

Before you begin, you'll need to [download and install the Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started) if you haven't already.

### Setup

```shell
shopify app init --template=https://github.com/Shopify/shopify-app-template-extension-only
```

### Local Development

```shell
shopify app dev
```

Press P to open the URL to your app. Once you click install, you can start development.

Local development is powered by [Shopify CLI](https://shopify.dev/docs/apps/build/cli-for-apps/test-apps-locally). It logs into your account, connects to an app, provides environment variables, updates remote config, creates a tunnel and provides commands to generate extensions.

## How it works

### Authentication

This template uses [Shopify managed installation](https://shopify.dev/docs/apps/build/authentication-authorization/app-installation). Shopify handles the OAuth flow and app installation automatically. Once installed, the app is fully embedded in the Shopify Admin.

### Querying data

This template uses [Direct API access](https://shopify.dev/docs/api/app-home#direct-api-access) — the Shopify Admin API is called directly from the browser using App Bridge. No server-side code is needed.

This template comes pre-configured with examples of querying data using GraphQL with direct API access, and using [metaobjects](https://shopify.dev/docs/apps/custom-data/metaobjects) to store and retrieve structured app data — see [/shared/models/faq.ts](./shared/models/faq.ts).

### App Bridge

[App Bridge](https://shopify.dev/docs/api/app-bridge) is loaded automatically in embedded apps.

### Polaris Web Components

This template uses [Polaris Web Components](https://shopify.dev/docs/api/app-home/web-components) — the native custom element version of Polaris that works in any framework (including Preact). No additional package installation is required as they are provided automatically in the Shopify Admin iframe.

## GraphQL Codegen

This template is pre-configured with [GraphQL Codegen](https://the-guild.dev/graphql/codegen) to generate TypeScript types from your GraphQL queries.

To regenerate types after updating queries:

```shell
npm run codegen
```

To watch for changes:

```shell
npm run codegen:watch
```

## Build

Build the app by running:

Using npm:

```shell
npm run build
```

Using yarn:

```shell
yarn build
```

Using pnpm:

```shell
pnpm run build
```

## Shopify Dev MCP

This template is configured with the Shopify Dev MCP. This instructs [Cursor](https://cursor.com/), [GitHub Copilot](https://github.com/features/copilot), [Claude Code](https://claude.com/product/claude-code), and [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) to use the Shopify Dev MCP.

For more information on the Shopify Dev MCP please read [the documentation](https://shopify.dev/docs/apps/build/devmcp).

## Metafields and Metaobjects

This template uses [metaobjects](https://shopify.dev/docs/apps/custom-data/metaobjects) and [metafields](https://shopify.dev/docs/apps/custom-data/metafields) to store structured app data without a custom database.

### Metaobject: FAQ

The template defines a `faq` metaobject type for storing FAQ entries. Each FAQ has a question, answer, a flag to control visibility on the FAQ page, and optional product associations.

Defined in `shopify.app.toml`:

```toml
[metaobjects.app.faq]
name = "FAQ"

[metaobjects.app.faq.fields.question]
name = "Question"
type = "single_line_text_field"
required = true

[metaobjects.app.faq.fields.answer]
name = "Answer"
type = "multi_line_text_field"
required = true

[metaobjects.app.faq.fields.show_on_faq_page]
name = "Show on FAQ page"
type = "boolean"

[metaobjects.app.faq.fields.products]
name = "Products"
type = "list.product_reference"
```

### Metafield: Product FAQ

A metafield definition links individual products to a FAQ metaobject entry, allowing merchants to associate a FAQ with specific products.

```toml
[product.metafields.app.faq]
name = "FAQ"
description = "FAQ for this product"
type = "metaobject_reference<$app:faq>"
access.admin = "merchant_read_write"
```

These definitions are automatically synced to Shopify when you run `shopify app dev` or `shopify app deploy`. See [/shared/models/faq.ts](./shared/models/faq.ts) for the client-side model that reads and writes these metaobjects via the Admin GraphQL API.

## Resources

Preact & Vite:

- [Preact docs](https://preactjs.com/guide/v10/getting-started)
- [Vite docs](https://vite.dev/)

Shopify:

- [Intro to Shopify apps](https://shopify.dev/docs/apps/getting-started)
- [Direct API access](https://shopify.dev/docs/api/app-home#direct-api-access)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- [App Bridge](https://shopify.dev/docs/api/app-bridge)
- [Polaris Web Components](https://shopify.dev/docs/api/app-home/web-components)
- [Metaobjects](https://shopify.dev/docs/apps/custom-data/metaobjects)
- [App extensions](https://shopify.dev/docs/apps/app-extensions/list)
- [Shopify Functions](https://shopify.dev/docs/api/functions)

## Dress-up element metafields

The storefront already stores dress-up data as Shopify metaobjects. Do not create Product or Product Variant records for this feature:

- `character_item` is the Accessories/element resource.
- `character` is the compatible-character resource.
- `character_pose` and `character_item_asset` retain the existing per-pose artwork mapping.

The setup command creates constrained `METAOBJECT` metafield definitions for `character_item` entries. It never updates or deletes metafield values. It checks existing definitions first, so running it again reports `EXISTS` instead of creating duplicates.

Required app scopes are `read_metaobject_definitions` and `write_metaobject_definitions`. They are declared in `shopify.app.toml`; deploy the configuration and update/reinstall the app on the development store so the new grants are present.

### Installation

1. Connect the Shopify app to a development store and deploy the updated app configuration if needed.
2. Set `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_API_VERSION`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, and `SHOPIFY_ENV=development`. Do not commit their values.
3. Preview the setup (read-only):

   ```shell
   npm run setup:element-metafields
   ```

4. Apply it to the development store:

   ```shell
   npm run setup:element-metafields -- --apply
   ```

5. Run the apply command a second time. All three lines should report `EXISTS`, with no duplicate-definition error.
6. Deploy/restart the app or publish the updated theme as appropriate.
7. In Shopify Admin, open **Settings → Custom data → Metaobjects → Character item** and verify:

   - `custom.element_category`
   - `custom.element_compatibility`
   - `custom.compatible_character_ids`

8. Populate sample Nature, Food, and Objects entries. Verify universal items appear for every character, character-specific items appear only for referenced characters, and an existing accessory such as a bow still appears and works.

The command prints only action, qualified key, definition ID, and type. It never prints the access token or secret. A shop not explicitly marked `SHOPIFY_ENV=development` cannot be changed unless `--confirm-production` is also passed; only use that flag after explicit production approval.

### Data examples

Nature item:

```text
custom.element_category: nature
custom.element_compatibility: universal
custom.compatible_character_ids: empty
```

Existing bow:

```text
custom.element_category: accessories
custom.element_compatibility: universal (or character-specific when existing behavior is restricted)
custom.compatible_character_ids: empty for universal; select character metaobjects only when restricted
```

Legacy entries remain visible: missing category is treated as `accessories`, while missing compatibility preserves the existing pose-asset behavior.
