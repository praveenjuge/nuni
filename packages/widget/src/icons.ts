import arrowUp from "vadivam/strings/arrow-up"
import bot from "vadivam/strings/bot"
import check from "vadivam/strings/check"
import eye from "vadivam/strings/eye"
import eyeOff from "vadivam/strings/eye-off"
import smile from "vadivam/strings/face-slightly-smiling"
import image from "vadivam/strings/image"
import list from "vadivam/strings/list"
import comment from "vadivam/strings/message-circle"
import edit from "vadivam/strings/pen-line"
import pen from "vadivam/strings/pen-tool"
import search from "vadivam/strings/search"
import target from "vadivam/strings/target"
import trash from "vadivam/strings/trash"
import user from "vadivam/strings/user"
import close from "vadivam/strings/x"

// Vadivam has no brand marks, so the GitHub logo stays hand-drawn.
const github = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5z"/></svg>`

export const ICONS = {
  comment,
  list,
  eye,
  eyeOff,
  close,
  check,
  trash,
  edit,
  bot,
  smile,
  user,
  arrowUp,
  search,
  target,
  image,
  pen,
  github,
} as const
