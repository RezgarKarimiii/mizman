import {NextResponse} from "next/server"; import {db} from "@/lib/db";
export async function GET(){const cafes=await db.cafe.findMany({include:{branches:true},orderBy:{createdAt:"desc"}});return NextResponse.json(cafes)}
