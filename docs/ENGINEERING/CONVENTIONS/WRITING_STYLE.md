# Writing Style

Every English text in NotaFlow uses two rules. The **inverted pyramid** sets the structure: the answer first, then the context, then the detail. **Simplified Technical English** (ASD-STE100) sets the sentences: short, common words, active voice, one word for one thing.

This applies to docs, `AGENTS.md` files, PR titles and descriptions, commit messages, issues, reviews, and code comments (with the [comment budget](CODE_COMMENTS.md) on top). Product UI strings and quotes from code, logs, or third-party documents are the exception.

---

# Structure: the inverted pyramid

Put the most important information first. Then the context. Then the detail. This is the order that a news report uses, and it is the order that a reader needs.

The reason is simple: **a reader can stop at any line**. If they stop after line one, they must still have the answer.

## The three levels

| Level | Content                                     | Length          | Who reads it       |
| ----- | ------------------------------------------- | --------------- | ------------------ |
| 1     | The answer, the decision, or the ask        | One sentence    | Everybody          |
| 2     | Why it matters, and who must act            | 2 to 5 bullets  | The people it hits |
| 3     | The evidence, the steps, and the background | A link, or a later section | The one person who digs in |

## The rules

### 1. Lead with the answer, not with the story

Do not build up to the point. State it, then explain it.

| Do not write                                                                                                             | Write                                                                          |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| I was looking at the upload flow, and I found that some files take a long time. After some debugging I saw the OCR step is slow, so uploads over 20 pages now fail. | **PDF uploads over 20 pages fail today.** The OCR step times out. I am on it. |

### 2. One message, one point

A message with three unrelated points gets one answer, or none. Split it.

### 3. Name the ask, and name who must act

A reader must know if this message is for them, and what they must do.

| Do not write                          | Write                                                    |
| ------------------------------------- | -------------------------------------------------------- |
| Let me know what you think about this. | **Design:** does the empty state need an icon? I need the answer by Thursday. |

### 4. Cut level 3 into a link

The PR, the doc, and the dashboard hold the detail. Link them. Do not repeat what the reader can click.

### 5. Delete the preamble

"I wanted to share that", "Quick update", "Just checking in", and "Hope this makes sense" carry no content. Cut them. Cut the sign-off too.

## The test

Read only the first line. Does the reader have the answer?
If no, the pyramid is upside down. Move the answer up.

---

# Sentences: Simplified Technical English

**ASD-STE100 Simplified Technical English** (STE) is a controlled style: short sentences, common words, active voice, and one word for one meaning. It was written for aerospace manuals that engineers must read under pressure, in a second language. Our documents have the same job.

### 1. One idea per sentence

Keep a sentence under about 20 words. If a sentence has two ideas, make it two sentences.

| Do not write                                                                                                                      | Write                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| The id does two jobs, and they pull in different directions, which is why a random UUID satisfies the first and fails the second. | The id has two jobs, and the two jobs need different things. A random UUID does the first job. It fails the second job. |

### 2. Use the simplest word that is correct

If a 10-year-old does not know the word, replace it. Technical terms are allowed when they are the real name of the thing (`UUIDv5`, `webhook`, `attribution window`). Fancy verbs are not.

| Do not write            | Write         |
| ----------------------- | ------------- |
| utilize, leverage       | use           |
| in order to             | to            |
| prior to, subsequent to | before, after |
| sets a ceiling on       | limits        |
| absorb, supersede       | replace       |
| approximately           | about         |

### 3. Active voice, and name who acts

Say who does the action. Passive voice hides the actor, and the actor is usually the important part.

| Do not write                           | Write                           |
| -------------------------------------- | ------------------------------- |
| The state is written by the front end. | The front end writes the state. |
| It was never applied.                  | Nobody applied the rule.        |

### 4. One word for one thing

Pick a term and repeat it. Do not use synonyms for variety, a reader must not stop to ask if two words mean the same thing. Write `front end` or `back end` the same way in the whole document. Do not switch between "event", "signal", and "hit" for one concept.

### 5. No idioms, no metaphors, no jokes

An idiom does not translate, and a model can read it as a fact.

| Do not write                        | Write                                         |
| ----------------------------------- | --------------------------------------------- |
| The money is in hand.               | We received the payment.                      |
| Ten events burn in minutes.         | Ten events happen in minutes.                 |
| A forged value poisons the bidding. | A forged value damages the bidding algorithm. |

### 6. No long noun chains

Three nouns in a row is the limit. Break the chain with a preposition.

| Do not write                     | Write                                        |
| -------------------------------- | -------------------------------------------- |
| ad platform conversion value map | the map of conversion values per ad platform |

### 7. Give instructions as commands

Write the imperative. Do not soften it.

| Do not write                       | Write          |
| ---------------------------------- | -------------- |
| You may want to run the tests.     | Run the tests. |
| It would be good to set the value. | Set the value. |

### 8. Write full words

No contractions (`do not`, not `don't`). Write an abbreviation in full on its first use, then use the short form. US spelling: `behavior`, `optimization`, `organize`.

### 9. Use tables and lists for anything complex

A table beats a paragraph for a comparison, a set of options, or a mapping. A list beats a paragraph for steps. This is an STE rule, and it is also the fastest way to make a document reviewable.

### 10. Keep code as it is

File paths, identifiers, commands, error strings, and quotes from code never change to fit the style. Put them in backticks and leave them alone.

---

## GitHub

- The title is level 1. It must carry the change on its own.
- The first paragraph of the body is level 2. Say what changed and why.
- Everything else is level 3.
- GitHub is always English. See [Which language](#which-language).

## Documents

- The first line after the title states the verdict, the decision, or the answer.
- A reader who reads only that line must not get a wrong idea.
- Sections carry the detail, in the order that a reader needs it, and not in the order that you found it.

---

## Which language

STE says _how_ to write English. It does not say that everything must be English.

1. If the request names a language, use that language.
2. If a convention names the language of the artifact, follow the convention. GitHub is always English: PRs, commits, branches, labels, reviews, issues.
3. If a message goes to one person, use that person's language.
4. Otherwise, match the language of the message that you answer.

If the result is English, apply the rules above.

## How to check a document

Read it and ask seven questions:

1. Does the first line carry the answer? If no, move the answer up.
2. Is the ask clear, and is the person who must act named?
3. Is any sentence longer than about 20 words? Split it.
4. Is there a word that a 10-year-old does not know, and that is not a technical name? Replace it.
5. Is there an idiom or a metaphor? Delete it and say the fact.
6. Does one concept have two names? Choose one.
7. Does the text contain an em dash or a banned word? See [Project directives](#project-directives).

## Project directives

These rules come on top of the rules above.

- No em dash. Use a comma, a colon, or a full stop.
- Banned words and phrases: "delve", "testament", "beacon", "revolutionize", "in today's fast-paced world", "not only... but also", "it's important to remember".
- Do not open with a rhetorical question.
- No dramatic two-part headings.
- No meta-commentary such as "Now let's explore".
- Mix short sentences with longer explanations.
