/**
 * Markdown Metrics Parser
 * Real-time analysis of Markdown documents for productivity, document health, quality, and developer stats.
 */

export interface IssueLocation {
  line: number;
  text?: string;
  offset?: number;
}

export interface ParsedDocMetrics {
  wordCount: number;
  charCount: number;
  sentenceCount: number;
  readingTimeMin: number;
  readabilityGrade: number;
  
  headingsCount: number;
  codeBlocksCount: number;
  tablesCount: number;
  imagesCount: number;
  linksCount: number;
  
  brokenLinksCount: number;
  brokenLinks: IssueLocation[];
  emptySectionsCount: number;
  emptySections: IssueLocation[];
  
  completeness: {
    readme: boolean;
    installation: boolean;
    usage: boolean;
    contributing: boolean;
    faq: boolean;
    license: boolean;
  };
  
  grammarSuggestions: number;
  passiveVoiceCount: number;
  passiveVoice: IssueLocation[];
  longSentencesCount: number;
  longSentences: IssueLocation[];
  repeatedWords: { word: string; count: number }[];
  undefinedAcronyms: string[];
  missingAltTextCount: number;
  missingAltTextIssues: IssueLocation[];
  unclosedCodeFences: number;
  unclosedCodeFenceLines: IssueLocation[];
  markdownLintIssues: number;
  
  codeToTextRatio: number;
  languageDistribution: { lang: string; lines: number; percentage: number }[];
}

export function parseDocumentMetrics(text: string): ParsedDocMetrics {
  const cleanText = text || '';
  
  // 1. Basic Counts
  const words = cleanText.trim() ? cleanText.trim().split(/\s+/).filter(w => w.length > 0) : [];
  const wordCount = words.length;
  const charCount = cleanText.replace(/\s/g, '').length;
  
  // Sentences (approximate split by punctuation followed by space or end of line)
  const sentences = cleanText.split(/[.!?]+(\s+|$)/).filter(s => s && s.trim().length > 0);
  const sentenceCount = Math.max(1, sentences.length);
  
  const readingTimeMin = Math.max(1, Math.round(wordCount / 200));
  
  // Coleman-Liau Readability Grade: 0.0588 * L - 0.296 * S - 15.8
  // L = average number of letters per 100 words
  // S = average number of sentences per 100 words
  let readabilityGrade = 0;
  if (wordCount > 0) {
    const letters = cleanText.replace(/[^a-zA-Z]/g, '').length;
    const L = (letters / wordCount) * 100;
    const S = (sentenceCount / wordCount) * 100;
    readabilityGrade = Math.max(1, Math.min(18, Math.round(0.0588 * L - 0.296 * S - 15.8)));
  }
  
  // 2. Structure Counts
  const lines = cleanText.split('\n');
  let headingsCount = 0;
  let codeBlocksCount = 0;
  let inCodeBlock = false;
  let tablesCount = 0;
  let imagesCount = 0;
  let linksCount = 0;
  let unclosedCodeFences = 0;
  
  // Language extraction
  const languagesMap: { [key: string]: number } = {};
  let currentLanguageLines = 0;
  let currentLanguage = '';
  let codeLinesTotal = 0;

  // Track headings for empty sections
  const headingIndices: number[] = [];
  
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    
    // Headings
    if (/^#{1,6}\s+/.test(trimmed)) {
      headingsCount++;
      headingIndices.push(idx);
    }
    
    // Code blocks
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        // Closing code block
        inCodeBlock = false;
        if (currentLanguage) {
          languagesMap[currentLanguage] = (languagesMap[currentLanguage] || 0) + currentLanguageLines;
        }
        currentLanguage = '';
        currentLanguageLines = 0;
      } else {
        // Opening code block
        inCodeBlock = true;
        codeBlocksCount++;
        const lang = trimmed.slice(3).trim().toLowerCase();
        currentLanguage = lang || 'plain text';
        currentLanguageLines = 0;
      }
    } else if (inCodeBlock) {
      currentLanguageLines++;
      codeLinesTotal++;
    }
    
    // Tables (lines starting/ending with | or having multiple |s)
    if (!inCodeBlock && trimmed.startsWith('|') && trimmed.includes('-')) {
      // separator line
      tablesCount++;
    }
    
    // Images & Links (if not in code block)
    if (!inCodeBlock) {
      // Markdown Images: ![alt](url)
      const imgMatches = trimmed.match(/!\[.*?\]\(.*?\)/g);
      if (imgMatches) {
        imagesCount += imgMatches.length;
      }
      // Markdown Links: [text](url) - subtract image count
      const linkMatches = trimmed.match(/\[.*?\]\(.*?\)/g);
      if (linkMatches) {
        linksCount += linkMatches.length;
      }
    }
  });
  
  const unclosedCodeFenceLines: IssueLocation[] = [];
  if (inCodeBlock) {
    unclosedCodeFences = 1;
    // Find the opening fence line
    const openLine = lines.findIndex(l => l.trim().startsWith('```') && !l.trim().startsWith('````'));
    unclosedCodeFenceLines.push({ line: Math.max(0, openLine), text: 'Unclosed code block' });
    if (currentLanguage) {
      languagesMap[currentLanguage] = (languagesMap[currentLanguage] || 0) + currentLanguageLines;
    }
  }

  // 3. Broken Links & Empty Sections
  let brokenLinksCount = 0;
  const brokenLinks: IssueLocation[] = [];
  if (cleanText) {
    // Empty link URLs: [text]() or containing only #, todo, placeholder, localhost
    const linkRegex = /\[.*?\]\((.*?)\)/g;
    let match;
    while ((match = linkRegex.exec(cleanText)) !== null) {
      const url = match[1].trim();
      if (!url || url === '#' || url.toLowerCase().includes('todo') || url.toLowerCase().includes('placeholder') || url.toLowerCase().includes('localhost')) {
        // Find line number by counting newlines before match index
        const line = cleanText.slice(0, match.index).split('\n').length - 1;
        brokenLinksCount++;
        brokenLinks.push({ line, text: `Broken link: ${match[0]}` });
      }
    }
  }
  
  // Empty sections (heading lines followed immediately by another heading or only blank lines before another heading/EOF)
  let emptySectionsCount = 0;
  const emptySections: IssueLocation[] = [];
  for (let i = 0; i < headingIndices.length; i++) {
    const startIdx = headingIndices[i];
    const endIdx = i < headingIndices.length - 1 ? headingIndices[i + 1] : lines.length;
    let hasContent = false;
    for (let j = startIdx + 1; j < endIdx; j++) {
      if (lines[j].trim().length > 0) {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) {
      emptySectionsCount++;
      emptySections.push({ line: startIdx, text: lines[startIdx].trim() });
    }
  }
  
  // 4. Documentation Completeness
  const completeness = {
    readme: /^#{1,3}\s+.*(readme|about)/mi.test(cleanText),
    installation: /install/i.test(cleanText),
    usage: /usage|getting\s+started/i.test(cleanText),
    contributing: /contribut/i.test(cleanText),
    faq: /faq|frequently\s+asked/i.test(cleanText),
    license: /license/i.test(cleanText)
  };
  
  // 5. Quality Metrics
  let passiveVoiceCount = 0;
  let longSentencesCount = 0;
  const fillerWordsMap: { [key: string]: number } = {};
  const acronymsMap: { [key: string]: boolean } = {};
  let missingAltTextCount = 0;
  
  const longSentences: IssueLocation[] = [];
  const passiveVoice: IssueLocation[] = [];
  // Long sentences (20+ words)
  sentences.forEach((s, si) => {
    const sWords = s.trim().split(/\s+/).filter(w => w.length > 0);
    if (sWords.length > 20) {
      longSentencesCount++;
      // Approximate line by finding the sentence start in the text
      const sentenceStartIdx = cleanText.indexOf(s.trim());
      if (sentenceStartIdx !== -1) {
        const line = cleanText.slice(0, sentenceStartIdx).split('\n').length - 1;
        longSentences.push({ line, text: s.trim().slice(0, 60) + '...' });
      }
    }
    
    // Passive voice: "is/was/were/am/are/been/be/being" followed by an "-ed" verb
    const passiveRegex = /\b(is|was|were|am|are|been|be|being)\b\s+\w+ed\b/gi;
    const passiveMatches = [...s.matchAll(passiveRegex)];
    if (passiveMatches.length > 0) {
      passiveVoiceCount += passiveMatches.length;
      passiveMatches.forEach(m => {
        const sentenceStartIdx = cleanText.indexOf(s.trim());
        if (sentenceStartIdx !== -1) {
          const offset = sentenceStartIdx + (m.index || 0);
          const line = cleanText.slice(0, offset).split('\n').length - 1;
          passiveVoice.push({ line, offset, text: m[0] });
        }
      });
    }
  });
  
  // Alt text validation
  const missingAltTextIssues: IssueLocation[] = [];
  const imageRegex = /!\[(.*?)\]\((.*?)\)/g;
  let imgMatch;
  while ((imgMatch = imageRegex.exec(cleanText)) !== null) {
    const altText = imgMatch[1].trim();
    if (!altText) {
      missingAltTextCount++;
      const line = cleanText.slice(0, imgMatch.index).split('\n').length - 1;
      missingAltTextIssues.push({ line, text: 'Image missing alt text' });
    }
  }
  
  // Filler words and Acronyms
  const fillerList = ['simply', 'just', 'actually', 'basically', 'literally', 'easy', 'obviously', 'clearly', 'really'];
  words.forEach(w => {
    const cleanWord = w.toLowerCase().replace(/[^a-z]/g, '');
    if (fillerList.includes(cleanWord)) {
      fillerWordsMap[cleanWord] = (fillerWordsMap[cleanWord] || 0) + 1;
    }
    
    // Acronyms (Uppercase words, 3+ characters, e.g., API, SDK, REST)
    const upperWord = w.replace(/[^A-Z]/g, '');
    if (upperWord.length >= 3 && upperWord.length <= 5) {
      // Check if it's defined anywhere in the text (e.g., "API (Application Programming Interface)" or glossary)
      const lowercaseDoc = cleanText.toLowerCase();
      const hasDefinition = lowercaseDoc.includes(upperWord.toLowerCase()) && 
        (lowercaseDoc.includes('stand for') || lowercaseDoc.includes('mean') || lowercaseDoc.includes('interface') || lowercaseDoc.includes('kit') || lowercaseDoc.includes('represent'));
      acronymsMap[upperWord] = hasDefinition;
    }
  });
  
  // Repeated filler words sorted
  const repeatedWords = Object.entries(fillerWordsMap)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count);
    
  // Undefined acronyms
  const undefinedAcronyms = Object.entries(acronymsMap)
    .filter(([_, defined]) => !defined)
    .map(([acronym]) => acronym);
    
  // Sum grammar issues
  const grammarSuggestions = passiveVoiceCount + longSentencesCount + repeatedWords.reduce((acc, c) => acc + c.count, 0);
  
  // Markdown lint counts
  const markdownLintIssues = brokenLinksCount + emptySectionsCount + missingAltTextCount + unclosedCodeFences;
  
  // 6. Developer Stats
  // Code ratio
  const codeToTextRatio = charCount > 0 ? Math.round((codeLinesTotal * 40 / charCount) * 100) : 0; // approximate code line length as 40 characters
  
  // Languages distribution
  const totalLangLines = Object.values(languagesMap).reduce((a, b) => a + b, 0);
  const languageDistribution = Object.entries(languagesMap)
    .map(([lang, linesCount]) => {
      const displayLang = lang.charAt(0).toUpperCase() + lang.slice(1);
      return {
        lang: displayLang,
        lines: linesCount,
        percentage: totalLangLines > 0 ? Math.round((linesCount / totalLangLines) * 100) : 0
      };
    })
    .sort((a, b) => b.lines - a.lines);
    
  return {
    wordCount,
    charCount,
    sentenceCount,
    readingTimeMin,
    readabilityGrade,
    
    headingsCount,
    codeBlocksCount,
    tablesCount,
    imagesCount,
    linksCount,
    
    brokenLinksCount,
    brokenLinks,
    emptySectionsCount,
    emptySections,
    
    completeness,
    
    grammarSuggestions,
    passiveVoiceCount,
    passiveVoice,
    longSentencesCount,
    longSentences,
    repeatedWords,
    undefinedAcronyms,
    missingAltTextCount,
    missingAltTextIssues,
    unclosedCodeFences,
    unclosedCodeFenceLines,
    markdownLintIssues: Math.max(markdownLintIssues, grammarSuggestions > 0 ? Math.round(grammarSuggestions / 2) : 0),
    
    codeToTextRatio: Math.min(95, Math.max(5, codeToTextRatio)),
    languageDistribution
  };
}
