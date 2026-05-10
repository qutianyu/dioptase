declare module "react-simple-code-editor" {
  import * as React from "react";

  interface EditorProps {
    value: string;
    onValueChange: (value: string) => void;
    highlight: (code: string) => string;
    padding?: number;
    style?: React.CSSProperties;
    textareaId?: string;
    textareaClassName?: string;
    preClassName?: string;
    tabSize?: number;
    insertSpaces?: boolean;
    ignoreTabKey?: boolean;
    disabled?: boolean;
  }

  export default class Editor extends React.Component<EditorProps> {}
}
