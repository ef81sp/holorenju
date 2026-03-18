import { REVIEW_VCF_OPTIONS } from "@/logic/cpu/review/forcedLossCheck";
import { findVCFSequence } from "@/logic/cpu/search/vcf";
import { createBoardFromRecord, formatMove } from "@/logic/gameRecordParser";

const record =
  "H8 I9 F8 I8 G9 I7 I6 H10 G8 G7 H7 F9 H5 H6 G11 G10 E8 D8 I10 J11 J7 K8 J5 K4 G5 I5 J6 J4 K3 J8 I4";

// 31手目まで（I4まで）の局面で白番
const { board } = createBoardFromRecord(record);

// フルVCF探索（maxDepth制限なし）
const vcf = findVCFSequence(board, "white", REVIEW_VCF_OPTIONS);
if (vcf) {
  console.log("VCF found!");
  console.log("firstMove:", formatMove(vcf.firstMove));
  console.log("sequence:", vcf.sequence.map(formatMove).join(" "));
  console.log("seqLen:", vcf.sequence.length);
} else {
  console.log("No VCF found");
}
