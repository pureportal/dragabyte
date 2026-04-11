import type { RenameRule } from './types';

export function applyRules(originalName: string, rules: RenameRule[], index: number, isDirectory: boolean = false): string {
  // 1. Separate Name and Extension
  let nameStem = originalName;
  let extension = '';
  
  if (!isDirectory) {
      const lastDotIndex = originalName.lastIndexOf('.');
      if (lastDotIndex > 0) {
          nameStem = originalName.substring(0, lastDotIndex);
          extension = originalName.substring(lastDotIndex); // includes '.'
      }
  }

  // 2. Apply rules
  for (const rule of rules) {
    if (!rule.active) continue;
    
    // Check target type (file vs folder)
    if (rule.targetType === 'file' && isDirectory) continue;
    if (rule.targetType === 'folder' && !isDirectory) continue;

    switch (rule.type) {
      case 'replace': {
        const find = rule.find || '';
        const replace = rule.replace || '';
        if (!find) continue;

        try {
          if (rule.useRegex) {
            const regex = new RegExp(find, rule.matchAll ? 'g' : '');
            nameStem = nameStem.replace(regex, replace);
          } else {
            if (rule.matchAll) {
              nameStem = nameStem.split(find).join(replace);
            } else {
              nameStem = nameStem.replace(find, replace);
            }
          }
        } catch (e) {
          // invalid regex
        }
        break;
      }

      case 'prefix':
        if (rule.rawText) {
          nameStem = rule.rawText + nameStem;
        }
        break;

      case 'suffix':
        if (rule.rawText) {
          nameStem = nameStem + rule.rawText;
        }
        break;

      case 'remove': {
        const count = rule.removeCount || 0;
        if (count <= 0) continue;
        if (rule.removeFrom === 'start') {
          nameStem = nameStem.substring(count);
        } else if (rule.removeFrom === 'end') {
          nameStem = nameStem.substring(0, Math.max(0, nameStem.length - count));
        }
        break;
      }

      case 'case': {
        // Advanced: Support regex targeting for case
        if (rule.useRegex && rule.find) {
            try {
                const regex = new RegExp(rule.find, rule.matchAll ? 'g' : '');
                nameStem = nameStem.replace(regex, (match) => applyCase(match, rule.caseType));
            } catch (e) {
                // ignore invalid regex
            }
        } else {
            nameStem = applyCase(nameStem, rule.caseType);
        }
        break;
      }

      case 'extension': {
         // This rule affects only extension (files only)
         if (isDirectory) break;
         
         if (rule.caseType === 'lowercase') extension = extension.toLowerCase();
         if (rule.caseType === 'uppercase') extension = extension.toUpperCase();
         break;
      }

      case 'numbering': {
          const start = rule.numberStart ?? 1;
          const step = rule.numberStep ?? 1;
          const currentVal = start + (index * step);
          // Simple zero padding
          const pad = rule.numberFormat ? rule.numberFormat.length : 0;
          let numStr = currentVal.toString();
          if (pad > 0) {
              numStr = numStr.padStart(pad, '0');
          }
          
          if (rule.addTo === 'suffix') {
             nameStem = nameStem + "-" + numStr;
          } else {
             nameStem = numStr + "-" + nameStem;
          }
          break;
      }
    }
  }

  return nameStem + extension;
}

function applyCase(str: string, type?: string): string {
    switch (type) {
        case 'lowercase': return str.toLowerCase();
        case 'uppercase': return str.toUpperCase();
        case 'camelCase': return toCamelCase(str);
        case 'pascalCase': return toPascalCase(str);
        case 'kebabCase': return toKebabCase(str);
        case 'sentenceCase': return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
        default: return str;
    }
}

function toCamelCase(str: string): string {
    return str
        .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => {
            return index === 0 ? word.toLowerCase() : word.toUpperCase();
        })
        .replace(/\s+/g, '');
}

function toPascalCase(str: string): string {
    return str
        .replace(/\w+/g, (w) => {
             if (w.length > 0) return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
             return w;
        })
        .replace(/\s+/g, '');
}

function toKebabCase(str: string): string {
    const match = str.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g);
    if (!match) return str;
    return match.map(x => x.toLowerCase()).join('-');
}
