# GPL Language

GPL Language is a foundational extension for Microsoft Dynamics 365 Business Central, built using the AL (Application Language) development environment.

## Overview

This extension provides a basic framework and starting point for developing Business Central customizations and extensions.

## Prerequisites

- Microsoft Dynamics 365 Business Central (On-Premises or Cloud)
- Visual Studio Code
- AL Language Extension for VS Code
- Business Central development environment

## Project Structure

```
GPL_language/
├── src/
│   └── GPLBase.Codeunit.al    # Base codeunit with core functionality
├── .vscode/
│   ├── launch.json             # Debug configuration
│   ├── settings.json           # AL extension settings
│   └── ruleset.json            # Code analysis rules
├── app.json                    # Extension manifest
├── .gitignore                  # Git ignore rules
├── LICENSE                     # MIT License
└── README.md                   # This file
```

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/nir414/GPL_language.git
cd GPL_language
```

### 2. Configure Your Environment

Edit `.vscode/launch.json` to match your Business Central server configuration:

```json
{
  "server": "http://your-bc-server",
  "serverInstance": "BC",
  "authentication": "UserPassword"
}
```

### 3. Download Symbols

In VS Code, press `Ctrl+Shift+P` and run:
- `AL: Download symbols`

### 4. Build and Deploy

Press `F5` to build and deploy the extension to your Business Central instance.

## Features

- **GPL Base Codeunit**: Provides initialization and validation procedures
- **Code Analysis**: Includes ruleset for maintaining code quality
- **Modern AL Practices**: Uses NoImplicitWith and modern AL features

## ID Range

This extension uses object IDs in the range: **50100-50149**

## Development

### Adding New Objects

1. Create new AL files in the `src/` directory
2. Follow the naming convention: `ObjectName.ObjectType.al`
3. Use object IDs within the designated range (50100-50149)
4. Run code analysis before committing changes

### Code Quality

This project uses AL code analyzers:
- CodeCop: Enforces coding standards
- UICop: Validates UI elements
- PerTenantExtensionCop: Ensures extension compatibility

## Version

Current version: **1.0.0.0**

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues and questions, please open an issue on the GitHub repository.
