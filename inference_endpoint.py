import onnxruntime as ort

# Load only the main file. 
# ONNX Runtime will automatically look for and load 'resent18_trained.onnx.data' 
# in the exact same directory.
session = ort.InferenceSession("resent18_trained.onnx", providers=["CPUExecutionProvider"])
