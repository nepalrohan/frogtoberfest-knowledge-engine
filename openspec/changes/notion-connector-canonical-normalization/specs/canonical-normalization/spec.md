## Purpose

Transforms external Notion block structures into a provider-neutral representation and normalizes them into the canonical document schema for persistence and downstream knowledge processing.

## ADDED Requirements

### Requirement: Supported Block Type Parsing and Rich-Text Extraction
The system SHALL parse external Notion rich-text elements and map supported block types into provider-neutral structured representations without reordering text elements or losing inline hyperlinks.

#### Scenario: Heading extraction
- **WHEN** a block has type `heading_1`, `heading_2`, or `heading_3`
- **THEN** the system SHALL map the block to a provider-neutral Heading element preserving its specific level and plain text content

#### Scenario: Paragraph rich-text extraction
- **WHEN** a block has type `paragraph` with multiple rich-text segments containing annotations and URLs
- **THEN** the system SHALL extract the text in original sequential order preserving valid link URLs

#### Scenario: List item mapping
- **WHEN** a block has type `bulleted_list_item` or `numbered_list_item`
- **THEN** the system SHALL map the block into an unordered or ordered List Item element respectively

#### Scenario: Task item mapping
- **WHEN** a block has type `to_do`
- **THEN** the system SHALL map the block into a Task element retaining the text and the boolean checked status

#### Scenario: Toggle container mapping
- **WHEN** a block has type `toggle` with nested child blocks
- **THEN** the system SHALL map the block into a structured Container element retaining its title label and all parsed nested children

### Requirement: Explicit Handling of Unsupported and Malformed Blocks
The system SHALL handle unsupported block types and malformed supported blocks explicitly without crashing document normalization or silently dropping diagnostics.

#### Scenario: Unsupported block skipped according to policy
- **WHEN** an external block type is not among the supported types (such as `image` or `table`)
- **THEN** the system SHALL record an unsupported block diagnostic with the block identifier and type, while continuing to process the remaining valid blocks

#### Scenario: Malformed block diagnostic recording
- **WHEN** a supported block type is encountered with invalid or missing required payload properties
- **THEN** the system SHALL flag the block as malformed, record a parsing error diagnostic containing the block ID, and refrain from misclassifying it as unsupported

### Requirement: Canonical Markdown and Frontmatter Normalization
The system SHALL normalize parsed provider-neutral content into standard GitHub Flavored Markdown (GFM) prepended with a metadata frontmatter header.

#### Scenario: Normalized markdown generation
- **WHEN** provider-neutral elements representing headings, paragraphs, lists, tasks, and toggles are normalized
- **THEN** the system SHALL format the elements into valid GitHub Flavored Markdown using `#` headers, `- [ ]` / `- [x]` task syntax, and standard list indentation

#### Scenario: Frontmatter header injection
- **WHEN** normalizing a document with page title, source type, source URL, last updated timestamp, and metadata
- **THEN** the system SHALL inject a YAML frontmatter block at the top of the normalized markdown containing title, source, source_url, updated_at, and hierarchy

### Requirement: Canonical Document Validation and Provenance Integrity
The system SHALL produce a canonical document payload that strictly validates against the target storage schema, verifies tenant and external provenance, and includes a SHA-256 content hash.

#### Scenario: Complete canonical document payload creation
- **WHEN** a valid parsed Notion page is normalized
- **THEN** the system SHALL output a payload conforming to the canonical document contract containing `sourceType` set to 'notion', `sourceId`, `sourceUrl`, `title`, `rawContent`, `normalizedContent`, `contentHash` computed via SHA-256, `sourceUpdatedAt`, and `metadata`

#### Scenario: Validation failure on missing required fields
- **WHEN** a document lacks a mandatory field such as `sourceId` or `title`
- **THEN** the system SHALL reject normalization and return validation error diagnostics detailing the missing fields
