# GPL Language

GPL (Guided Parallel Language) is a programming language designed for robot automation and parallel workflow execution. This project provides the foundational GPL language runtime and base libraries.

## Overview

GPL combines familiar VB.NET-style syntax with specialized features for robot control and automation tasks, making it easy to develop maintainable and scalable automation applications.

## Prerequisites

- Visual Studio Code
- GPL Language Support Extension for VS Code (recommended for syntax highlighting and IntelliSense)

## Project Structure

```
GPL_language/
├── src/
│   └── GPLBase.Codeunit.al    # Base GPL runtime codeunit
├── app.json                    # GPL project configuration
├── .gitignore                  # Git ignore rules
├── LICENSE                     # MIT License
└── README.md                   # This file
```

## Getting Started

### 1. Install GPL Language Support

Install the GPL Language Support extension for VS Code to get syntax highlighting, IntelliSense, and other language features.

### 2. Create Your First GPL Project

1. Create a new folder for your project
2. Copy `app.json` as a template
3. Start writing GPL code in the `src/` directory

### 3. Development

Write GPL files (`.gpl`, `.gpo` extensions) and use the VS Code extension features:

- **F12**: Go to Definition
- **Shift+F12**: Find All References
- **Ctrl+Space**: IntelliSense/Auto-completion

## Features

- **GPL Base Runtime**: Core functionality initialization and version management
- **VB.NET Compatibility**: GPL supports VB.NET-style syntax and constructs
- **Module System**: Organize code with classes, modules, and functions
- **Robot Automation**: Designed for parallel workflow and automation tasks

## Development

### Language Features

GPL supports:

- Functions and Subroutines (Sub/Function)
- Classes and Modules
- Public/Private/Shared modifiers
- VB.NET-compatible syntax

### Best Practices

1. Use meaningful names for functions, classes, and variables
2. Organize related code into modules
3. Follow the project structure conventions
4. Use the GPL Language Support extension for code quality

## Related Projects

- **GPL Language Support**: VS Code extension providing IntelliSense, Go to Definition, Find References, and VB.NET compatibility checking for GPL files

## Version

Current version: **1.0.0.0**

## License

This project is licensed under the MIT License. See `LICENSE` for details.

## Contributing

Contributions are welcome. Please submit a Pull Request.
