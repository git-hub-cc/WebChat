import os
from PIL import Image

def resize_image(image_path, target_width):
    """
    Resizes an image to a target width, maintaining aspect ratio.
    Overwrites the original image.

    Args:
        image_path (str): The path to the image file.
        target_width (int): The desired width of the image.
    """
    try:
        img = Image.open(image_path)
        original_width, original_height = img.size

        if original_width == 0:
            print(f"Skipping {image_path}: original width is zero.")
            return False

        # Calculate new height to maintain aspect ratio
        aspect_ratio = original_height / original_width
        target_height = int(round(target_width * aspect_ratio))

        # Ensure height is at least 1 pixel
        if target_height < 1:
            target_height = 1

        print(f"Resizing {image_path}: ({original_width}x{original_height}) -> ({target_width}x{target_height})")

        # Resize the image
        # Image.Resampling.LANCZOS is a high-quality downsampling filter
        resized_img = img.resize((target_width, target_height), Image.Resampling.LANCZOS)

        # Save the resized image, overwriting the original
        # optimize=True attempts to reduce file size further
        resized_img.save(image_path, format='PNG', optimize=True)
        return True
    except FileNotFoundError:
        print(f"Error: Image not found at {image_path}")
        return False
    except Exception as e:
        print(f"Error processing {image_path}: {e}")
        return False

def process_directory(directory_path, target_width=13):
    """
    Walks through a directory and its subdirectories,
    resizing all PNG images found.
    """
    processed_count = 0
    error_count = 0

    for root, _, files in os.walk(directory_path):
        for filename in files:
            if filename.lower().endswith(".png"):
                image_path = os.path.join(root, filename)
                if resize_image(image_path, target_width):
                    processed_count += 1
                else:
                    error_count += 1

    print(f"\n--- Processing Complete ---")
    print(f"Successfully resized: {processed_count} images.")
    print(f"Errors encountered: {error_count} images.")

if __name__ == "__main__":
    current_directory = "."  # Process the current directory
    target_image_width = 130

    print(f"Starting PNG image resizing in '{os.path.abspath(current_directory)}' and its subdirectories.")
    print(f"Target width: {target_image_width}px, height will be adjusted proportionally.")
    print("IMPORTANT: This script will OVERWRITE original images.")

    # Optional: Add a confirmation step
    # confirm = input("Are you sure you want to proceed? (yes/no): ")
    # if confirm.lower() != 'yes':
    #     print("Operation cancelled by user.")
    #     exit()

    process_directory(current_directory, target_image_width)